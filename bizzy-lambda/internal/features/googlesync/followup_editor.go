package googlesync

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/router"
)

// FollowUpEditor writes the follow-ups she adds, edits and deletes in the
// app to the calendar, as `! Name: summary` events with the notes as their
// description, then stores them as the next sync would.
type FollowUpEditor struct {
	Calendar func(ctx context.Context) (Calendar, error)
	Clients  interface {
		List(ctx context.Context) ([]clients.Client, error)
	}
	FollowUps FollowUpStore
	Location  *time.Location
}

// FollowUpDraft is a follow-up as she fills it in.
type FollowUpDraft struct {
	ClientID string `json:"clientId"`
	// SessionID links a new follow-up to the session it came from.
	SessionID string `json:"sessionId,omitempty"`
	// Date (YYYY-MM-DD) makes it an all-day reminder; otherwise Start is
	// when it is due.
	Date    string     `json:"date,omitempty"`
	Start   *time.Time `json:"start,omitempty"`
	Summary string     `json:"summary"`
	Notes   string     `json:"notes"`
}

// followUpMinutes is how long a timed follow-up blocks in the calendar.
const followUpMinutes = 15

func RegisterFollowUpEditor(r *router.Router, e FollowUpEditor) {
	r.Mutation("followUps.create", router.Typed(e.create))
	r.Mutation("followUps.update", router.Typed(e.update))
	r.Mutation("followUps.delete", router.Typed(e.delete))
}

func (e FollowUpEditor) create(ctx context.Context, d FollowUpDraft) (any, error) {
	client, err := e.validate(ctx, d)
	if err != nil {
		return nil, err
	}
	in, err := followUpInput(d, client, nil)
	if err != nil {
		return nil, err
	}
	if d.SessionID != "" {
		in.Private = map[string]string{calendar.PropSessionID: d.SessionID}
	}

	cal, err := e.Calendar(ctx)
	if err != nil {
		return nil, err
	}
	event, err := cal.Insert(ctx, in)
	if err != nil {
		return nil, err
	}
	return e.store(ctx, event)
}

type updateFollowUpInput struct {
	EventID string `json:"eventId"`
	FollowUpDraft
}

func (e FollowUpEditor) update(ctx context.Context, in updateFollowUpInput) (any, error) {
	client, err := e.validate(ctx, in.FollowUpDraft)
	if err != nil {
		return nil, err
	}
	cal, err := e.Calendar(ctx)
	if err != nil {
		return nil, err
	}
	live, err := cal.Get(ctx, in.EventID)
	if err != nil || live.Cancelled {
		_ = e.FollowUps.Delete(ctx, in.EventID)
		return nil, followups.ErrGone
	}
	input, err := followUpInput(in.FollowUpDraft, client, &live)
	if err != nil {
		return nil, err
	}
	event, err := cal.Update(ctx, in.EventID, live.ETag, input)
	if err != nil {
		return nil, err
	}
	return e.store(ctx, event)
}

func (e FollowUpEditor) delete(ctx context.Context, in eventInput) (any, error) {
	cal, err := e.Calendar(ctx)
	if err != nil {
		return nil, err
	}
	live, err := cal.Get(ctx, in.EventID)
	if err == nil && !live.Cancelled {
		err = cal.Delete(ctx, in.EventID, live.ETag)
	}
	if err != nil && !errors.Is(err, calendar.ErrGone) {
		return nil, err
	}
	return nil, e.FollowUps.Delete(ctx, in.EventID)
}

// store saves the follow-up as the sync would read its event.
func (e FollowUpEditor) store(ctx context.Context, event calendar.Event) (followups.FollowUp, error) {
	all, err := e.Clients.List(ctx)
	if err != nil {
		return followups.FollowUp{}, err
	}
	return Syncer{FollowUps: e.FollowUps, Location: e.Location}.saveFollowUp(ctx, event, clients.AliasesOf(all))
}

const (
	maxFollowUpSummary = 200
	maxFollowUpNotes   = 8000
)

func (e FollowUpEditor) validate(ctx context.Context, d FollowUpDraft) (clients.Client, error) {
	switch {
	case d.ClientID == "":
		return clients.Client{}, apperr.Invalid("choose a client")
	case d.Date == "" && d.Start == nil:
		return clients.Client{}, apperr.Invalid("choose when to follow up")
	case utf8.RuneCountInString(strings.TrimSpace(d.Summary)) > maxFollowUpSummary:
		return clients.Client{}, apperr.Invalid("keep the summary to %d characters; the rest goes in the notes", maxFollowUpSummary)
	case len(d.Notes) > maxFollowUpNotes:
		return clients.Client{}, apperr.Invalid("the notes are too long for a calendar event")
	}
	if d.Date != "" {
		if _, err := time.Parse(time.DateOnly, d.Date); err != nil {
			return clients.Client{}, apperr.Invalid("the date must be YYYY-MM-DD")
		}
	}
	return findClient(ctx, e.Clients, d.ClientID)
}

// followUpInput writes the draft as an event, keeping the name she wrote if
// it still means the client.
func followUpInput(d FollowUpDraft, client clients.Client, existing *calendar.Event) (calendar.EventInput, error) {
	name := writtenName(client, existing)
	summary := strings.Join(strings.Fields(d.Summary), " ")
	title := calendar.FormatFollowUp(calendar.FollowUpTitle{Name: name, Summary: summary})
	if parsed, err := calendar.ParseFollowUp(title); err != nil || parsed.Name != name {
		return calendar.EventInput{}, apperr.Invalid("%q can't be written in a follow-up title. Give the client a name without a colon.", name)
	}

	notes := strings.TrimSpace(d.Notes)
	in := calendar.EventInput{Title: title, Description: &notes}
	if existing != nil {
		in.ColorID = existing.ColorID
	}
	if d.Date != "" {
		in.Date = d.Date
	} else {
		in.Start = d.Start.UTC()
		in.End = in.Start.Add(followUpMinutes * time.Minute)
	}
	return in, nil
}

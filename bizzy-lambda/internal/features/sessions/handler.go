package sessions

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

// HandlerStore is what the handlers read and write.
type HandlerStore interface {
	Store
	ListByTime(ctx context.Context, from, to time.Time) ([]Session, error)
	PageByClient(ctx context.Context, clientID, cursor string, limit int) (dynamo.Page[Session], error)
	Notes(ctx context.Context, id string) (Notes, error)
	SaveNotes(ctx context.Context, n Notes) error
}

type handler struct {
	repo  HandlerStore
	judge Judge
	after After
	now   func() time.Time
}

// After runs once what she recorded on a session changed: an edit waiting
// in the calendar may be refused for it.
type After func(ctx context.Context, sessionID string) error

// Register serves sessions to the app, and the notes she records. Adding,
// editing and deleting the booking, and its payment, are the book's
// commands (see internal/features/book); judge is the book's verdict on
// them, for the views.
func Register(r *router.Router, repo HandlerStore, judge Judge, after After, now func() time.Time) {
	h := handler{repo: repo, judge: judge, after: after, now: now}
	r.Query("sessions.list", router.Typed(h.list))
	r.Query("sessions.listByClient", router.Typed(h.listByClient))
	r.Mutation("sessions.saveRecord", router.Typed(h.saveRecord))
}

type listInput struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

// list returns sessions starting in [from, to), for history by month.
func (h handler) list(ctx context.Context, in listInput) (any, error) {
	if in.From.IsZero() || in.To.IsZero() || !in.To.After(in.From) {
		return nil, apperr.Invalid("from and to are required, from first")
	}
	if in.To.Sub(in.From) > 400*24*time.Hour {
		return nil, apperr.Invalid("ask for at most a year at a time")
	}
	all, err := h.repo.ListByTime(ctx, in.From, in.To.Add(-time.Second))
	if err != nil {
		return nil, err
	}
	return Views(ctx, all, h.now(), h.judge)
}

// TimelinePage is how many sessions a client's timeline loads at a time.
const TimelinePage = 20

type listByClientInput struct {
	ClientID string `json:"clientId"`
	Cursor   string `json:"cursor"`
}

// listByClient returns a page of a client's sessions, newest first.
func (h handler) listByClient(ctx context.Context, in listByClientInput) (any, error) {
	if in.ClientID == "" {
		return nil, apperr.Invalid("choose a client")
	}
	page, err := h.repo.PageByClient(ctx, in.ClientID, in.Cursor, TimelinePage)
	if err != nil {
		return nil, err
	}
	views, err := Views(ctx, page.Items, h.now(), h.judge)
	return dynamo.Page[View]{Items: views, Next: page.Next}, err
}

// Limits on what she types, well inside DynamoDB's 400 KB per item.
const (
	maxSummary = 300
	maxNotes   = 50_000
)

type saveRecordInput struct {
	ID      string `json:"id"`
	Summary string `json:"summary"`
	// Notes nil keeps the notes as they are: the to-do list writes only the
	// summary.
	Notes *string `json:"notes"`
}

// saveRecord saves the summary and notes, as she types (the app saves after
// a pause). Clearing both, with no files attached, clears the record.
func (h handler) saveRecord(ctx context.Context, in saveRecordInput) (any, error) {
	summary := strings.TrimSpace(in.Summary)
	var notes string
	if in.Notes != nil {
		notes = strings.TrimSpace(*in.Notes)
	}
	switch {
	case utf8.RuneCountInString(summary) > maxSummary:
		return nil, apperr.Invalid("keep the summary to %d characters; the rest goes in the notes", maxSummary)
	case len(notes) > maxNotes:
		return nil, apperr.Invalid("the notes are too long to save")
	}

	now := h.now().UTC()
	current, found, err := h.repo.Get(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, ErrGone
	}
	if err := current.CanRecord(now); err != nil {
		return nil, err
	}

	if in.Notes != nil {
		if err := h.repo.SaveNotes(ctx, Notes{SessionID: in.ID, Text: notes, UpdatedAt: now}); err != nil {
			return nil, err
		}
	}
	saved, err := Update(ctx, h.repo, in.ID, func(s *Session) error {
		hasNotes := notes != ""
		if in.Notes == nil {
			hasNotes = s.Record != nil && s.Record.HasNotes
		}
		s.setRecord(summary, hasNotes, s.Files(), now)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if h.after != nil {
		if err := h.after(ctx, saved.ID); err != nil {
			return nil, err
		}
	}
	views, err := Views(ctx, []Session{saved}, now, h.judge)
	if err != nil {
		return nil, err
	}
	return views[0], nil
}

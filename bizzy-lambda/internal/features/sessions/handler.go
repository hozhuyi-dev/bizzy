package sessions

import (
	"context"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

type store interface {
	Store
	ListByTime(ctx context.Context, from, to time.Time) ([]Session, error)
	PageByClient(ctx context.Context, clientID, cursor string, limit int) (dynamo.Page[Session], error)
	ListByStatus(ctx context.Context, status Status) ([]Session, error)
	Notes(ctx context.Context, eventID string) (Notes, error)
	SaveNotes(ctx context.Context, n Notes) error
}

type handler struct {
	repo store
	now  func() time.Time
}

// Register serves sessions to the app, and the notes she records. Adding,
// editing and deleting the booking goes through the calendar (see
// googlesync.RegisterEditor); payments go through the payments feature.
func Register(r *router.Router, repo store) {
	h := handler{repo: repo, now: time.Now}
	r.Register("sessions.list", router.Typed(h.list))
	r.Register("sessions.listByClient", router.Typed(h.listByClient))
	r.Register("sessions.listRemoved", h.listRemoved)
	r.Register("sessions.saveRecord", router.Typed(h.saveRecord))
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
	return h.repo.ListByTime(ctx, in.From, in.To.Add(-time.Second))
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
	return h.repo.PageByClient(ctx, in.ClientID, in.Cursor, TimelinePage)
}

// listRemoved returns the sessions deleted from the calendar but kept for
// her data on them.
func (h handler) listRemoved(ctx context.Context, _ json.RawMessage) (any, error) {
	return h.repo.ListByStatus(ctx, StatusRemoved)
}

// Limits on what she types, well inside DynamoDB's 400 KB per item.
const (
	maxSummary = 300
	maxNotes   = 50_000
)

type saveRecordInput struct {
	EventID string `json:"eventId"`
	Summary string `json:"summary"`
	// Notes nil keeps the notes as they are: the to-do list writes only the
	// summary.
	Notes *string `json:"notes"`
}

// saveRecord saves the summary and notes, as she types (the app saves after
// a pause). Clearing both clears the record.
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
	current, found, err := h.repo.Get(ctx, in.EventID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, ErrGone
	}
	if current.Start.After(now) {
		return nil, apperr.Conflict("Notes can be written once the session has started.")
	}

	if in.Notes != nil {
		if err := h.repo.SaveNotes(ctx, Notes{EventID: in.EventID, Text: notes, UpdatedAt: now}); err != nil {
			return nil, err
		}
	}
	return Update(ctx, h.repo, in.EventID, func(s *Session) error {
		hasNotes := notes != ""
		if in.Notes == nil {
			hasNotes = s.Record != nil && s.Record.HasNotes
		}
		if summary == "" && !hasNotes {
			s.Record = nil
			return nil
		}
		s.Record = &Record{Summary: summary, HasNotes: hasNotes, UpdatedAt: now}
		return nil
	})
}

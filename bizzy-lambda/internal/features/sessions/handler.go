package sessions

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

// Store is the part of the repository that Update and the handlers use.
type Store interface {
	Get(ctx context.Context, eventID string) (Session, bool, error)
	Save(ctx context.Context, s Session) (Session, error)
}

type store interface {
	Store
	ListByTime(ctx context.Context, from, to time.Time) ([]Session, error)
	PageByClient(ctx context.Context, clientID, cursor string, limit int) (dynamo.Page[Session], error)
	ListByStatus(ctx context.Context, status Status) ([]Session, error)
	Notes(ctx context.Context, eventID string) (Notes, error)
	SaveNotes(ctx context.Context, n Notes) error
}

// ErrGone is a session no longer stored.
var ErrGone = apperr.NotFound("This session is no longer in the calendar.")

// Update applies change to the stored session and saves it. When something
// else wrote it in between (usually the sync), it reads it again and
// applies the change afresh.
func Update(ctx context.Context, s Store, eventID string, change func(*Session) error) (Session, error) {
	for attempt := 0; ; attempt++ {
		current, found, err := s.Get(ctx, eventID)
		if err != nil {
			return Session{}, err
		}
		if !found {
			return Session{}, ErrGone
		}
		if err := change(&current); err != nil {
			return Session{}, err
		}
		saved, err := s.Save(ctx, current)
		if errors.Is(err, dynamo.ErrConflict) && attempt < 3 {
			continue
		}
		return saved, err
	}
}

// AfterChange reconciles a client after a payment changes their activity.
type AfterChange func(ctx context.Context, clientIDs ...string) error

type handler struct {
	repo        store
	afterChange AfterChange
	now         func() time.Time
	loc         *time.Location
}

// Register serves sessions to the app, and the parts she records. Adding,
// editing and deleting the booking goes through the calendar; see
// googlesync.RegisterEditor.
func Register(r *router.Router, repo store, afterChange AfterChange, loc *time.Location) {
	h := handler{repo: repo, afterChange: afterChange, now: time.Now, loc: loc}
	r.Register("sessions.list", router.Typed(h.list))
	r.Register("sessions.listByClient", router.Typed(h.listByClient))
	r.Register("sessions.listRemoved", h.listRemoved)
	r.Register("sessions.saveRecord", router.Typed(h.saveRecord))
	r.Register("sessions.setPayment", router.Typed(h.setPayment))
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
	Notes   string `json:"notes"`
}

// saveRecord saves the summary and notes, as she types (the app saves after
// a pause). Clearing both clears the record.
func (h handler) saveRecord(ctx context.Context, in saveRecordInput) (any, error) {
	summary, notes := strings.TrimSpace(in.Summary), strings.TrimSpace(in.Notes)
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

	if err := h.repo.SaveNotes(ctx, Notes{EventID: in.EventID, Text: notes, UpdatedAt: now}); err != nil {
		return nil, err
	}
	return Update(ctx, h.repo, in.EventID, func(s *Session) error {
		if summary == "" && notes == "" {
			s.Record = nil
			return nil
		}
		s.Record = &Record{Summary: summary, HasNotes: notes != "", UpdatedAt: now}
		return nil
	})
}

type paymentInput struct {
	Status      PaymentStatus `json:"status"`
	Method      PaymentMethod `json:"method"`
	AmountCents int64         `json:"amountCents"`
	// PaidOn defaults to today.
	PaidOn string `json:"paidOn"`
}

type setPaymentInput struct {
	EventID string `json:"eventId"`
	// Payment nil undoes a payment recorded by mistake.
	Payment *paymentInput `json:"payment"`
}

func (h handler) setPayment(ctx context.Context, in setPaymentInput) (any, error) {
	now := h.now()
	payment, err := h.payment(in.Payment, now)
	if err != nil {
		return nil, err
	}

	saved, err := Update(ctx, h.repo, in.EventID, func(s *Session) error {
		switch {
		case s.RemovedAt != nil:
			return apperr.Conflict("Restore the session before changing its payment.")
		case s.Status == StatusTentative:
			return apperr.Conflict("Confirm the session before recording its payment.")
		case !s.Status.Delivered():
			return apperr.Conflict("Fix the calendar entry before recording its payment.")
		case s.Receipt != nil:
			return apperr.Conflict("A receipt covers this payment. Cancel or discard it first.")
		}
		s.Payment = payment
		return nil
	})
	if err != nil {
		return nil, err
	}
	// Payments are her income: the client's activity sums them.
	if h.afterChange != nil && saved.ClientID != "" {
		if err := h.afterChange(ctx, saved.ClientID); err != nil {
			return nil, err
		}
	}
	return saved, nil
}

func (h handler) payment(in *paymentInput, now time.Time) (*Payment, error) {
	if in == nil {
		return nil, nil
	}
	p := &Payment{Status: in.Status, PaidOn: strings.TrimSpace(in.PaidOn), UpdatedAt: now.UTC()}
	if p.PaidOn == "" {
		p.PaidOn = now.In(h.loc).Format(time.DateOnly)
	}
	if _, err := time.Parse(time.DateOnly, p.PaidOn); err != nil {
		return nil, apperr.Invalid("the payment date must be YYYY-MM-DD")
	}

	switch in.Status {
	case PaymentPaid:
		if _, ok := MethodLabels[in.Method]; !ok {
			return nil, apperr.Invalid("choose how it was paid")
		}
		if in.AmountCents <= 0 {
			return nil, apperr.Invalid("enter the amount paid")
		}
		p.Method, p.AmountCents = in.Method, in.AmountCents
	case PaymentWaived:
	default:
		return nil, apperr.Invalid("a payment is paid or waived")
	}
	return p, nil
}

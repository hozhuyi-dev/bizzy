package sessions

import (
	"context"
	"encoding/json"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/router"
)

type store interface {
	Get(ctx context.Context, eventID string) (Session, bool, error)
	ListByTime(ctx context.Context, from, to time.Time) ([]Session, error)
	ListOpen(ctx context.Context) ([]Session, error)
	SetIgnored(ctx context.Context, eventID string, ignored bool) (bool, error)
}

// AfterChange reconciles a session she changed (Before is as it was stored).
type AfterChange func(ctx context.Context, before, after Session) error

type handler struct {
	repo        store
	afterChange AfterChange
}

func Register(r *router.Router, repo store, afterChange AfterChange) {
	h := handler{repo: repo, afterChange: afterChange}
	r.Register("sessions.listOpen", h.listOpen)
	r.Register("sessions.list", router.Typed(h.list))
	r.Register("sessions.setIgnored", router.Typed(h.setIgnored))
}

func (h handler) listOpen(ctx context.Context, _ json.RawMessage) (any, error) {
	return h.repo.ListOpen(ctx)
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

type setIgnoredInput struct {
	EventID string `json:"eventId"`
	Ignored bool   `json:"ignored"`
}

func (h handler) setIgnored(ctx context.Context, in setIgnoredInput) (any, error) {
	before, found, err := h.repo.Get(ctx, in.EventID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, apperr.NotFound("session not found")
	}
	if in.Ignored && before.Document != nil {
		return nil, apperr.Conflict("cancel the receipt for this session first")
	}

	if _, err := h.repo.SetIgnored(ctx, in.EventID, in.Ignored); err != nil {
		return nil, err
	}
	after := before
	after.Ignored = in.Ignored
	if err := h.afterChange(ctx, before, after); err != nil {
		return nil, err
	}
	return nil, nil
}

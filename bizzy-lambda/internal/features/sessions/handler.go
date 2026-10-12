package sessions

import (
	"context"
	"encoding/json"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/router"
)

type store interface {
	ListByTime(ctx context.Context, from, to time.Time) ([]Session, error)
	ListOpen(ctx context.Context) ([]Session, error)
}

type handler struct {
	repo store
}

// Register serves sessions to the app. Adding, editing and deleting one goes
// through the calendar; see googlesync.RegisterEditor.
func Register(r *router.Router, repo store) {
	h := handler{repo: repo}
	r.Register("sessions.listOpen", h.listOpen)
	r.Register("sessions.list", router.Typed(h.list))
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

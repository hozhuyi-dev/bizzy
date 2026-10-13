package todo

import (
	"context"
	"encoding/json"
	"time"

	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/router"
)

type Sessions interface {
	ListTodo(ctx context.Context, until time.Time) ([]sessions.Session, error)
}

type Packages interface {
	ListOpen(ctx context.Context) ([]packages.Package, error)
}

type FollowUps interface {
	ListOpen(ctx context.Context, until time.Time) ([]followups.FollowUp, error)
}

type Settings interface {
	Get(ctx context.Context) (settings.Settings, error)
}

type handler struct {
	sessions  Sessions
	packages  Packages
	followUps FollowUps
	settings  Settings
	now       func() time.Time
}

func Register(r *router.Router, s Sessions, p Packages, f FollowUps, cfg Settings, now func() time.Time) {
	h := handler{sessions: s, packages: p, followUps: f, settings: cfg, now: now}
	r.Query("todo.list", h.list)
}

func (h handler) list(ctx context.Context, _ json.RawMessage) (any, error) {
	cfg, err := h.settings.Get(ctx)
	if err != nil {
		return nil, err
	}
	now := h.now().UTC()
	day := 24 * time.Hour

	open, err := h.sessions.ListTodo(ctx, now.Add(time.Duration(cfg.ConfirmAheadDays)*day))
	if err != nil {
		return nil, err
	}
	unpaid, err := h.packages.ListOpen(ctx)
	if err != nil {
		return nil, err
	}
	due, err := h.followUps.ListOpen(ctx, now.Add(time.Duration(cfg.FollowUpAheadDays)*day))
	if err != nil {
		return nil, err
	}
	return Build(open, unpaid, due, now), nil
}

package todo

import (
	"context"
	"encoding/json"
	"time"

	"bizzy-lambda/internal/features/conflicts"
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

type Conflicts interface {
	ListOpen(ctx context.Context) ([]conflicts.Conflict, error)
}

type Settings interface {
	Get(ctx context.Context) (settings.Settings, error)
}

// Deps is what the list reads, and the book's verdicts for its views.
type Deps struct {
	Sessions      Sessions
	Packages      Packages
	FollowUps     FollowUps
	Conflicts     Conflicts
	Settings      Settings
	JudgeSessions sessions.Judge
	JudgePackages packages.Judge
	Now           func() time.Time
}

type handler struct{ Deps }

func Register(r *router.Router, d Deps) {
	h := handler{d}
	r.Query("todo.list", h.list)
}

func (h handler) list(ctx context.Context, _ json.RawMessage) (any, error) {
	cfg, err := h.Settings.Get(ctx)
	if err != nil {
		return nil, err
	}
	now := h.Now().UTC()
	day := 24 * time.Hour

	open, err := h.Sessions.ListTodo(ctx, now.Add(time.Duration(cfg.ConfirmAheadDays)*day))
	if err != nil {
		return nil, err
	}
	// Only what has something to do now is judged.
	var todo []sessions.Session
	for _, s := range open {
		if len(s.Todo(now)) > 0 {
			todo = append(todo, s)
		}
	}
	sessionViews, err := sessions.Views(ctx, todo, now, h.JudgeSessions)
	if err != nil {
		return nil, err
	}
	unpaid, err := h.Packages.ListOpen(ctx)
	if err != nil {
		return nil, err
	}
	var collect []packages.Package
	for _, p := range unpaid {
		if len(p.Todo(now)) > 0 {
			collect = append(collect, p)
		}
	}
	packageViews, err := packages.Views(ctx, collect, now, h.JudgePackages)
	if err != nil {
		return nil, err
	}
	due, err := h.FollowUps.ListOpen(ctx, now.Add(time.Duration(cfg.FollowUpAheadDays)*day))
	if err != nil {
		return nil, err
	}
	waiting, err := h.Conflicts.ListOpen(ctx)
	if err != nil {
		return nil, err
	}
	return Build(sessionViews, packageViews, due, waiting), nil
}

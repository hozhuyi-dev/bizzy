// Package todo is her to-do list on Home: every session and follow-up that
// needs her, in one list. Each kind keeps its own sparse "open" index, and
// both are read only a few days ahead, so the list stays small without any
// filtering in DynamoDB.
package todo

import (
	"cmp"
	"context"
	"encoding/json"
	"slices"
	"time"

	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/router"
)

type Kind string

const (
	KindSession  Kind = "session"
	KindFollowUp Kind = "followUp"
)

// Item is one thing to do. Exactly one of Session and FollowUp is set.
type Item struct {
	Kind Kind `json:"kind"`
	// At orders the list: when the session starts, or the follow-up is due.
	At       time.Time           `json:"at"`
	Reasons  []sessions.Reason   `json:"reasons,omitempty"`
	Session  *sessions.Session   `json:"session,omitempty"`
	FollowUp *followups.FollowUp `json:"followUp,omitempty"`
}

// Build merges what needs her as of now, oldest first. Sessions come from
// their open index, so only those with something left to do are kept.
func Build(open []sessions.Session, due []followups.FollowUp, now time.Time) []Item {
	items := []Item{}
	for _, s := range open {
		if reasons := s.Todo(now); len(reasons) > 0 {
			items = append(items, Item{Kind: KindSession, At: s.Start, Reasons: reasons, Session: &s})
		}
	}
	for _, f := range due {
		if f.DoneAt == nil {
			items = append(items, Item{Kind: KindFollowUp, At: f.Due, FollowUp: &f})
		}
	}
	slices.SortStableFunc(items, func(a, b Item) int {
		return cmp.Or(a.At.Compare(b.At), cmp.Compare(a.Kind, b.Kind))
	})
	return items
}

type Sessions interface {
	ListTodo(ctx context.Context, until time.Time) ([]sessions.Session, error)
}

type FollowUps interface {
	ListOpen(ctx context.Context, until time.Time) ([]followups.FollowUp, error)
}

type Settings interface {
	Get(ctx context.Context) (settings.Settings, error)
}

type handler struct {
	sessions  Sessions
	followUps FollowUps
	settings  Settings
	now       func() time.Time
}

func Register(r *router.Router, s Sessions, f FollowUps, cfg Settings) {
	h := handler{sessions: s, followUps: f, settings: cfg, now: time.Now}
	r.Register("todo.list", h.list)
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
	due, err := h.followUps.ListOpen(ctx, now.Add(time.Duration(cfg.FollowUpAheadDays)*day))
	if err != nil {
		return nil, err
	}
	return Build(open, due, now), nil
}

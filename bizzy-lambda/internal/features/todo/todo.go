// Package todo is her to-do list on Home: every session, package and
// follow-up that needs her, in one list. Each kind keeps its own sparse
// "open" index, read only a few days ahead, so the list stays small without
// any filtering in DynamoDB.
package todo

import (
	"cmp"
	"context"
	"encoding/json"
	"slices"
	"time"

	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/router"
)

type Kind string

const (
	KindSession  Kind = "session"
	KindFollowUp Kind = "followUp"
	KindPackage  Kind = "package"
)

// Item is one thing to do. Exactly one of Session, Package and FollowUp is
// set.
type Item struct {
	Kind Kind `json:"kind"`
	// At orders the list: when the session starts, the package was bought,
	// or the follow-up is due.
	At time.Time `json:"at"`
	// Reasons is what to do on a session or package; a follow-up has only
	// ReasonFix, when its title can't be read or matched.
	Reasons  []sessions.Reason   `json:"reasons,omitempty"`
	Session  *sessions.Session   `json:"session,omitempty"`
	Package  *packages.Package   `json:"package,omitempty"`
	FollowUp *followups.FollowUp `json:"followUp,omitempty"`
}

// Build merges what needs her as of now, oldest first. Sessions and
// packages come from their open indexes, so only those with something left
// to do are kept. A package bought in a session is collected on that
// session, so only one bought otherwise (or unlinked) is its own item.
func Build(open []sessions.Session, unpaid []packages.Package, due []followups.FollowUp, now time.Time) []Item {
	items := []Item{}
	for _, s := range open {
		if reasons := s.Todo(now); len(reasons) > 0 {
			items = append(items, Item{Kind: KindSession, At: s.Start, Reasons: reasons, Session: &s})
		}
	}
	for _, p := range unpaid {
		if p.CollectOnItsOwn() && !p.PurchasedAt.After(now) {
			items = append(items, Item{Kind: KindPackage, At: p.PurchasedAt, Reasons: []sessions.Reason{sessions.ReasonCollect}, Package: &p})
		}
	}
	for _, f := range due {
		if f.DoneAt == nil {
			item := Item{Kind: KindFollowUp, At: f.Due, FollowUp: &f}
			if f.Problem != "" {
				item.Reasons = []sessions.Reason{sessions.ReasonFix}
			}
			items = append(items, item)
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

func Register(r *router.Router, s Sessions, p Packages, f FollowUps, cfg Settings) {
	h := handler{sessions: s, packages: p, followUps: f, settings: cfg, now: time.Now}
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

// Package todo is her to-do list on Home: every session, package and
// follow-up that needs her, in one list. Each kind keeps its own sparse
// "open" index, read only a few days ahead, so the list stays small without
// any filtering in DynamoDB.
package todo

import (
	"cmp"
	"slices"
	"time"

	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
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
	Session  *sessions.View      `json:"session,omitempty"`
	Package  *packages.View      `json:"package,omitempty"`
	FollowUp *followups.FollowUp `json:"followUp,omitempty"`
}

// Build merges what needs her as of now, oldest first. Sessions and
// packages come from their open indexes, so only those with something left
// to do are kept. What is left to do on each comes from its rule table
// (rules.go in its feature).
func Build(open []sessions.Session, unpaid []packages.Package, due []followups.FollowUp, now time.Time) []Item {
	items := []Item{}
	for _, s := range open {
		if v := s.View(now); len(v.Todo) > 0 {
			items = append(items, Item{Kind: KindSession, At: s.Start, Reasons: v.Todo, Session: &v})
		}
	}
	for _, p := range unpaid {
		if v := p.View(now); len(v.Todo) > 0 {
			items = append(items, Item{Kind: KindPackage, At: p.PurchasedAt, Reasons: v.Todo, Package: &v})
		}
	}
	// An open follow-up is the task itself; its reasons are what to fix
	// first.
	for _, f := range due {
		if f.DoneAt == nil {
			items = append(items, Item{Kind: KindFollowUp, At: f.Due, Reasons: f.Todo(), FollowUp: &f})
		}
	}
	slices.SortStableFunc(items, func(a, b Item) int {
		return cmp.Or(a.At.Compare(b.At), cmp.Compare(a.Kind, b.Kind))
	})
	return items
}

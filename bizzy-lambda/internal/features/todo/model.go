// Package todo is her to-do list on Home: every session, package and
// follow-up that needs her, and every edit she made in the calendar that
// bizzy didn't apply, in one list. Each kind keeps its own sparse "open"
// index, read only a few days ahead, so the list stays small without any
// filtering in DynamoDB.
package todo

import (
	"cmp"
	"slices"
	"time"

	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/statemodel"
)

type Kind string

const (
	KindSession  Kind = "session"
	KindFollowUp Kind = "followUp"
	KindPackage  Kind = "package"
	KindConflict Kind = "conflict"
)

// Item is one thing to do. Exactly one of Session, Package, FollowUp and
// Conflict is set.
type Item struct {
	Kind Kind `json:"kind"`
	// At orders the list: when the session starts, the package was bought,
	// the follow-up is due, or the conflict was found.
	At time.Time `json:"at"`
	// Reasons is what to do on it.
	Reasons  []statemodel.Reason `json:"reasons,omitempty"`
	Session  *sessions.View      `json:"session,omitempty"`
	Package  *packages.View      `json:"package,omitempty"`
	FollowUp *followups.FollowUp `json:"followUp,omitempty"`
	Conflict *conflicts.View     `json:"conflict,omitempty"`
}

// Build merges what needs her as of now, oldest first. Sessions and
// packages come from their open indexes, so only those with something left
// to do are kept. What is left to do on each comes from its rule table
// (rules.go in its feature).
func Build(open []sessions.View, unpaid []packages.View, due []followups.FollowUp, waiting []conflicts.Conflict) []Item {
	items := []Item{}
	for _, v := range open {
		if len(v.Todo) > 0 {
			items = append(items, Item{Kind: KindSession, At: v.Start, Reasons: v.Todo, Session: &v})
		}
	}
	for _, v := range unpaid {
		if len(v.Todo) > 0 {
			items = append(items, Item{Kind: KindPackage, At: v.PurchasedAt, Reasons: v.Todo, Package: &v})
		}
	}
	// An open follow-up is the task itself; its reasons are what to fix
	// first.
	for _, f := range due {
		if f.DoneAt == nil {
			items = append(items, Item{Kind: KindFollowUp, At: f.Due, Reasons: f.Todo(), FollowUp: &f})
		}
	}
	for _, c := range waiting {
		v := c.View()
		items = append(items, Item{Kind: KindConflict, At: c.At, Reasons: v.Todo, Conflict: &v})
	}
	slices.SortStableFunc(items, func(a, b Item) int {
		return cmp.Or(a.At.Compare(b.At), cmp.Compare(a.Kind, b.Kind))
	})
	return items
}

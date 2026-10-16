package todo

import (
	"context"
	"time"

	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// View is one thing to do, as the app shows it: exactly one of Session,
// Package, FollowUp and Conflict is set, with what is left to do on it.
type View struct {
	Kind Kind `json:"kind"`
	// At orders the list: when the session starts, the package was
	// bought, the follow-up is due, or the edit was refused.
	At       time.Time       `json:"at"`
	Session  *sessions.View  `json:"session,omitempty"`
	Package  *packages.View  `json:"package,omitempty"`
	FollowUp *followups.View `json:"followUp,omitempty"`
	Conflict *conflicts.View `json:"conflict,omitempty"`
}

// Routes registers the to-do list's actions. used counts the sessions
// using a package's credits (packages.Usage).
func Routes(r *router.Router, run *txn.Runner, used packages.Usage) {
	r.Query("todo.list", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) ([]View, error) { return List(tx, used) })
	}))
}

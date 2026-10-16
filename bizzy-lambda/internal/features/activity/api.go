package activity

import (
	"context"

	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// View is one client's activity as the app shows it: computed, never
// stored, so it is its own shape.
type View = Client

// Routes registers the activity's action.
func Routes(r *router.Router, run *txn.Runner) {
	r.Query("activity.list", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) ([]View, error) { return All(tx) })
	}))
}

package billing

import (
	"context"

	"bizzy-lambda/internal/router"
)

// Register serves the reconcile's pricing to the app, so the booking form
// shows what will pay for a session without knowing the rules itself.
func Register(r *router.Router, reconciler *Reconciler) {
	r.Query("billing.preview", router.Typed(func(ctx context.Context, in PreviewInput) (any, error) {
		return reconciler.Preview(ctx, in)
	}))
}

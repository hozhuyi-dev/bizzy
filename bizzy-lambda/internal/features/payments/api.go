package payments

import (
	"context"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

type setRequest struct {
	Items []Item `json:"items"`
	// Payment nil undoes the items' payment.
	Payment *documents.PaymentInput `json:"payment"`
}

// Routes registers the payments' action. It answers nothing: the app
// reloads what was paid for.
func Routes(r *router.Router, run *txn.Runner) {
	r.Mutation("payments.set", router.Typed(func(ctx context.Context, in setRequest) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) { return nil, Set(tx, in.Items, in.Payment) })
	}))
}

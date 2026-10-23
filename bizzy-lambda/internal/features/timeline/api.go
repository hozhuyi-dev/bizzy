package timeline

import (
	"context"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/listing"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// searchRequest finds a client's story by words in their sessions'
// summaries and notes, follow-ups, packages' notes and document numbers,
// and by kind; no kinds takes every kind.
type searchRequest struct {
	listing.Request
	ClientID string `json:"clientId"`
	Kinds    []Kind `json:"kinds"`
}

// Routes registers the timeline's action.
func Routes(r *router.Router, run *txn.Runner) {
	r.Query("timeline.search", router.Typed(func(ctx context.Context, in searchRequest) (any, error) {
		if in.ClientID == "" {
			return nil, apperr.Invalid("Whose timeline?")
		}
		return txn.Read(ctx, run, func(tx *txn.Tx) (Page, error) {
			return Search(tx, in.ClientID, in.Request, in.Kinds)
		})
	}))
}

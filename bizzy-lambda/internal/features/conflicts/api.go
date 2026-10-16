package conflicts

import (
	"context"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// View is a conflict as the app shows it.
type View struct {
	EventID  string          `json:"eventId"`
	ItemKind string          `json:"itemKind,omitempty"`
	ItemID   string          `json:"itemId,omitempty"`
	Gone     bool            `json:"gone,omitempty"`
	Title    string          `json:"title"`
	Start    time.Time       `json:"start"`
	End      time.Time       `json:"end"`
	Message  string          `json:"message"`
	Remedies []apperr.Remedy `json:"remedies"`
	Since    time.Time       `json:"since"`
}

// ViewOf is a conflict as the app shows it.
func ViewOf(c *Conflict) View {
	return View{
		EventID: c.EventID, ItemKind: c.ItemKind, ItemID: c.ItemID, Gone: c.Gone, Title: c.Shown.Title, Start: c.Shown.Start, End: c.Shown.End,
		Message: c.Message, Remedies: c.Remedies, Since: c.Since,
	}
}

type targetRequest struct {
	ItemID string `json:"itemId"`
}

// Routes registers the conflicts' actions; resolving them is the sync's
// (see googlesync).
func Routes(r *router.Router, run *txn.Runner) {
	// conflicts.listByTarget lists the edits waiting on one session or
	// follow-up, for its page.
	r.Query("conflicts.listByTarget", router.Typed(func(ctx context.Context, in targetRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (any, error) {
			all, err := Conflicts.WithRef(tx, in.ItemID)
			out := []View{}
			for _, c := range all {
				out = append(out, ViewOf(c))
			}
			return out, err
		})
	}))
	r.Query("conflicts.list", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (any, error) {
			open, err := Conflicts.Open(tx)
			out := []View{}
			for _, c := range open {
				out = append(out, ViewOf(c))
			}
			return out, err
		})
	}))
}

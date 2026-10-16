package googlesync

import (
	"context"

	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// View is a sync run as the app shows it.
type View struct {
	At      string `json:"at"`
	Read    int    `json:"read"`
	Refused int    `json:"refused"`
	Error   string `json:"error,omitempty"`
}

// ViewOf is a run as the app shows it.
func ViewOf(r Run) View {
	return View{At: r.At.Format("2006-01-02T15:04:05Z07:00"), Read: r.Read, Refused: r.Refused, Error: r.Error}
}

type idRequest struct {
	ID string `json:"id"`
}

// Routes registers the sync's actions.
func Routes(r *router.Router, s *Sync) {
	r.Mutation("sync.run", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		run, err := s.Run(ctx)
		if err != nil {
			return nil, err
		}
		return ViewOf(run), nil
	}))
	// sync.status is the last run; null before the first.
	r.Query("sync.status", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		return txn.Read(ctx, s.Runner, func(tx *txn.Tx) (*View, error) {
			st, ok, err := States.Find(tx, stateID)
			if err != nil || !ok || st.Last == nil {
				return nil, err
			}
			v := ViewOf(*st.Last)
			return &v, nil
		})
	}))
	r.Mutation("calendar.revert", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		write, err := txn.Run(ctx, s.Runner, func(tx *txn.Tx) (item, error) {
			kind, id, err := Revert(tx, in.ID)
			return item{kind, id}, err
		})
		if err != nil || write.id == "" {
			return nil, err
		}
		return nil, s.writeItem(ctx, write.kind, write.id)
	}))
	r.Mutation("conflicts.apply", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return nil, s.Apply(ctx, in.ID)
	}))
}

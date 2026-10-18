package googlesync

import (
	"context"
	"time"

	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// View is a sync run as the app shows it.
type View struct {
	At      string `json:"at"`
	Read    int    `json:"read"`
	Refused int    `json:"refused"`
	Error   string `json:"error,omitempty"`
	// Back is how far back the calendar is read, while older events are
	// still to read (sync.backfill).
	Back string `json:"back,omitempty"`
}

// ViewOf is a run as the app shows it.
func ViewOf(r Run) View {
	v := View{At: r.At.Format(time.RFC3339), Read: r.Read, Refused: r.Refused, Error: r.Error}
	if !r.Back.IsZero() {
		v.Back = r.Back.UTC().Format(time.RFC3339)
	}
	return v
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
			last := *st.Last
			last.Back = backOf(st) // The backfill has read on since.
			v := ViewOf(last)
			return &v, nil
		})
	}))
	// sync.backfill reads the calendar a month further back; back is how
	// far back it is read, while older events are still to read.
	r.Mutation("sync.backfill", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		run, err := s.Backfill(ctx)
		if err != nil {
			return nil, err
		}
		return ViewOf(run), nil
	}))
	r.Mutation("calendar.revert", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		cal, err := s.current(ctx)
		if err != nil {
			return nil, err
		}
		write, err := txn.Run(ctx, s.Runner, func(tx *txn.Tx) (item, error) {
			kind, id, err := Revert(tx, in.ID)
			return item{kind, id}, err
		})
		if err != nil || write.id == "" {
			return nil, err
		}
		return nil, s.write(ctx, cal, write.kind, write.id)
	}))
	r.Mutation("conflicts.apply", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return nil, s.Apply(ctx, in.ID)
	}))
}

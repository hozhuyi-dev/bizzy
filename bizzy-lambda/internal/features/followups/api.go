package followups

import (
	"cmp"
	"context"
	"slices"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// View is a follow-up as the app shows it.
type View struct {
	ID         string     `json:"id"`
	ClientID   string     `json:"clientId"`
	ClientName string     `json:"clientName"`
	SessionID  string     `json:"sessionId,omitempty"`
	Due        time.Time  `json:"due"`
	AllDay     bool       `json:"allDay"`
	Minutes    int        `json:"minutes,omitempty"`
	Summary    string     `json:"summary"`
	Notes      string     `json:"notes"`
	DoneAt     *time.Time `json:"doneAt,omitempty"`
	Todo       []Reason   `json:"todo"`
}

// ViewOf is a follow-up as of now.
func ViewOf(tx *txn.Tx, fu *FollowUp) (View, error) {
	cfg, err := settings.Get(tx)
	if err != nil {
		return View{}, err
	}
	client, err := clients.Clients.Get(tx, fu.ClientID)
	if err != nil {
		return View{}, err
	}
	return View{
		ID: fu.ID, ClientID: fu.ClientID, ClientName: client.Name, SessionID: fu.SessionID,
		Due: fu.Due, AllDay: fu.AllDay, Minutes: fu.Minutes, Summary: fu.Summary, Notes: fu.Notes,
		DoneAt: fu.DoneAt, Todo: fu.Todo(tx.Now(), cfg.FollowUpAheadDays),
	}, nil
}

func viewsOf(tx *txn.Tx, all []*FollowUp) ([]View, error) {
	out := []View{}
	for _, fu := range all {
		v, err := ViewOf(tx, fu)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// List is which follow-ups to list.
type List string

const (
	ListUpcoming List = "upcoming"
	ListDone     List = "done"
)

type listRequest struct {
	View List `json:"view"`
}

type clientRequest struct {
	ClientID string `json:"clientId"`
}

type sessionRequest struct {
	SessionID string `json:"sessionId"`
}

type createRequest struct {
	Fields
	// SessionID is the session it is made from, if any.
	SessionID string `json:"sessionId,omitempty"`
}

type updateRequest struct {
	ID string `json:"id"`
	Fields
}

type idRequest struct {
	ID string `json:"id"`
}

type doneRequest struct {
	ID   string `json:"id"`
	Done bool   `json:"done"`
}

// Routes registers the follow-ups' actions.
func Routes(r *router.Router, run *txn.Runner) {
	one := func(ctx context.Context, do func(tx *txn.Tx) (*FollowUp, error)) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) {
			fu, err := do(tx)
			if err != nil {
				return nil, err
			}
			return ViewOf(tx, fu)
		})
	}

	// followUps.list lists those not done (soonest first) or done (latest
	// first).
	r.Query("followUps.list", router.Typed(func(ctx context.Context, in listRequest) (any, error) {
		if in.View != ListUpcoming && in.View != ListDone {
			return nil, apperr.Invalid("Unknown list %q.", in.View)
		}
		return txn.Read(ctx, run, func(tx *txn.Tx) ([]View, error) {
			var picked []*FollowUp
			if in.View == ListUpcoming {
				open, err := FollowUps.Open(tx)
				if err != nil {
					return nil, err
				}
				picked = open
			} else {
				all, err := FollowUps.All(tx)
				if err != nil {
					return nil, err
				}
				for _, fu := range all {
					if fu.DoneAt != nil {
						picked = append(picked, fu)
					}
				}
				slices.SortFunc(picked, func(a, b *FollowUp) int { return cmp.Compare(b.DoneAt.Unix(), a.DoneAt.Unix()) })
			}
			return viewsOf(tx, picked)
		})
	}))
	r.Query("followUps.listByClient", router.Typed(func(ctx context.Context, in clientRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) ([]View, error) {
			all, err := FollowUps.OfClient(tx, in.ClientID)
			if err != nil {
				return nil, err
			}
			return viewsOf(tx, all)
		})
	}))
	r.Query("followUps.listBySession", router.Typed(func(ctx context.Context, in sessionRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) ([]View, error) {
			all, err := FollowUps.WithRef(tx, in.SessionID)
			if err != nil {
				return nil, err
			}
			return viewsOf(tx, all)
		})
	}))
	r.Mutation("followUps.create", router.Typed(func(ctx context.Context, in createRequest) (any, error) {
		return one(ctx, func(tx *txn.Tx) (*FollowUp, error) { return Create(tx, in.Fields, in.SessionID) })
	}))
	r.Mutation("followUps.update", router.Typed(func(ctx context.Context, in updateRequest) (any, error) {
		return one(ctx, func(tx *txn.Tx) (*FollowUp, error) { return Update(tx, in.ID, in.Fields) })
	}))
	r.Mutation("followUps.setDone", router.Typed(func(ctx context.Context, in doneRequest) (any, error) {
		return one(ctx, func(tx *txn.Tx) (*FollowUp, error) { return SetDone(tx, in.ID, in.Done) })
	}))
	r.Mutation("followUps.delete", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) { return nil, Delete(tx, in.ID) })
	}))
}

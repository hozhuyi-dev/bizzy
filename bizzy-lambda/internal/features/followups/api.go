package followups

import (
	"context"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/listing"
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

// searchRequest finds follow-ups not done or done by words in their
// summary, notes or client's name, and by days due and clients; an empty
// filter takes every value.
type searchRequest struct {
	listing.Request
	View      List     `json:"view"`
	ClientIDs []string `json:"clientIds"`
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

type reachedOutRequest struct {
	ClientID string `json:"clientId"`
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

	// followUps.search finds those not done, soonest due first, or those
	// done, latest due first, a page at a time.
	r.Query("followUps.search", router.Typed(func(ctx context.Context, in searchRequest) (any, error) {
		if in.View != ListUpcoming && in.View != ListDone {
			return nil, apperr.Invalid("Unknown list %q.", in.View)
		}
		return txn.Read(ctx, run, func(tx *txn.Tx) (listing.Page[View], error) {
			from, to, err := in.Span(tx.Location())
			if err != nil {
				return listing.Page[View]{}, err
			}
			l := txn.List{Open: true, From: from, To: to}
			if in.View == ListDone {
				l = txn.List{From: from, To: to, Latest: true}
				if len(in.ClientIDs) == 1 {
					l.Client = in.ClientIDs[0]
				}
			}
			words := in.Words()
			return listing.Read(tx, FollowUps, l, in.Request, func(fu *FollowUp) (View, bool, error) {
				if (fu.DoneAt != nil) != (in.View == ListDone) || !listing.OneOf(in.ClientIDs, fu.ClientID) {
					return View{}, false, nil
				}
				v, err := ViewOf(tx, fu)
				return v, err == nil && words.In(v.ClientName, v.Summary, v.Notes), err
			})
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
	r.Mutation("followUps.reachedOut", router.Typed(func(ctx context.Context, in reachedOutRequest) (any, error) {
		return one(ctx, func(tx *txn.Tx) (*FollowUp, error) { return ReachedOut(tx, in.ClientID) })
	}))
	r.Mutation("followUps.setDone", router.Typed(func(ctx context.Context, in doneRequest) (any, error) {
		return one(ctx, func(tx *txn.Tx) (*FollowUp, error) { return SetDone(tx, in.ID, in.Done) })
	}))
	r.Mutation("followUps.delete", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) { return nil, Delete(tx, in.ID) })
	}))
}

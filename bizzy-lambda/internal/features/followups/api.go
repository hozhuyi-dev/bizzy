package followups

import (
	"context"
	"slices"
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

// BySession are the follow-ups made from one session.
func BySession(tx *txn.Tx, sessionID string) ([]View, error) {
	all, err := FollowUps.WithRef(tx, sessionID)
	if err != nil {
		return nil, err
	}
	return viewsOf(tx, all)
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

// Status is where a follow-up stands, as a search narrows by it.
type Status string

const (
	// StatusOpen is not done yet, overdue or not.
	StatusOpen Status = "open"
	// StatusOverdue is not done, and due before today.
	StatusOverdue Status = "overdue"
	StatusDone    Status = "done"
)

// Origin is where a follow-up came from: a session, or on its own.
type Origin string

const (
	OriginSession Origin = "session"
	OriginOwn     Origin = "own"
)

// searchRequest finds follow-ups by words in their summary, notes or
// client's name, and by days due, clients, how they stand and where they
// came from; an empty filter takes every value.
type searchRequest struct {
	listing.Request
	Statuses  []Status `json:"statuses"`
	Origins   []Origin `json:"origins"`
	ClientIDs []string `json:"clientIds"`
}

// list is where a search reads: those not done, soonest first, when it
// is for them alone (the to-do index holds only those), stopping at today
// for the overdue alone; else every one, latest due first, or a client's
// when it is for one.
func (in searchRequest) list(from, to, today time.Time) txn.List {
	open := len(in.Statuses) > 0 && !slices.Contains(in.Statuses, StatusDone)
	if open {
		if !slices.Contains(in.Statuses, StatusOpen) && (to.IsZero() || to.After(today)) {
			to = today.Add(-time.Second)
		}
		return txn.List{Open: true, From: from, To: to}
	}
	l := txn.List{From: from, To: to, Latest: true}
	if len(in.ClientIDs) == 1 {
		l.Client = in.ClientIDs[0]
	}
	return l
}

// takes says whether a follow-up is one the search is for, its words aside.
func (in searchRequest) takes(fu *FollowUp, today time.Time) bool {
	origin := OriginOwn
	if fu.SessionID != "" {
		origin = OriginSession
	}
	return listing.OneOf(in.ClientIDs, fu.ClientID) && listing.OneOf(in.Origins, origin) &&
		listing.AnyOf(in.Statuses, statuses(fu, today))
}

// statuses are every Status a follow-up has: open and overdue both, for
// one overdue.
func statuses(fu *FollowUp, today time.Time) []Status {
	switch {
	case fu.DoneAt != nil:
		return []Status{StatusDone}
	case fu.Due.Before(today):
		return []Status{StatusOpen, StatusOverdue}
	}
	return []Status{StatusOpen}
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

	// followUps.search finds follow-ups a page at a time: those not done
	// soonest due first, any others latest due first (see list).
	r.Query("followUps.search", router.Typed(func(ctx context.Context, in searchRequest) (any, error) {
		for _, s := range in.Statuses {
			if s != StatusOpen && s != StatusOverdue && s != StatusDone {
				return nil, apperr.Invalid("Unknown status %q.", s)
			}
		}
		return txn.Read(ctx, run, func(tx *txn.Tx) (listing.Page[View], error) {
			from, to, err := in.Span(tx.Location())
			if err != nil {
				return listing.Page[View]{}, err
			}
			now := tx.Now().In(tx.Location())
			today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, tx.Location())
			words := in.Words()
			return listing.Read(tx, FollowUps, in.list(from, to, today), in.Request, func(fu *FollowUp) (View, bool, error) {
				if !in.takes(fu, today) {
					return View{}, false, nil
				}
				v, err := ViewOf(tx, fu)
				return v, err == nil && words.In(v.ClientName, v.Summary, v.Notes), err
			})
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

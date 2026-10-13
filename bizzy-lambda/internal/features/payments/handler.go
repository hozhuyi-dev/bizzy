package payments

import (
	"context"
	"errors"
	"time"

	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
	"bizzy-lambda/internal/shared/money"
)

// Store reads the items and writes their payments all or none.
type Store interface {
	GetSession(ctx context.Context, eventID string) (sessions.Session, bool, error)
	GetPackage(ctx context.Context, id string) (packages.Package, bool, error)
	// Commit saves the sessions (versioned) and the packages' payments
	// together. dynamo.ErrConflict means one changed since it was read.
	Commit(ctx context.Context, ss []sessions.Session, ps []packages.Package) error
}

// AfterChange reconciles the clients whose payments changed: their income,
// and the sessions that mirror a package's.
type AfterChange func(ctx context.Context, clientIDs ...string) error

type handler struct {
	store       Store
	afterChange AfterChange
	now         func() time.Time
	loc         *time.Location
}

func Register(r *router.Router, store Store, afterChange AfterChange, loc *time.Location) {
	h := handler{store: store, afterChange: afterChange, now: time.Now, loc: loc}
	r.Register("payments.set", router.Typed(h.set))
}

type setInput struct {
	Items []Item `json:"items"`
	// Payment nil undoes the items' payments, recorded by mistake.
	Payment *money.Input `json:"payment"`
}

// maxAttempts bounds the retries when an item changed while saving (usually
// the sync): each attempt reads everything afresh.
const maxAttempts = 4

func (h handler) set(ctx context.Context, in setInput) (any, error) {
	if len(in.Items) == 0 {
		return nil, apperr.Invalid("choose what was paid")
	}
	seen := map[Item]bool{}
	for _, item := range in.Items {
		key := Item{Kind: item.Kind, ID: item.ID}
		if seen[key] {
			return nil, apperr.Invalid("each item is paid once")
		}
		seen[key] = true
	}

	for attempt := 1; ; attempt++ {
		clientIDs, err := h.apply(ctx, in)
		if errors.Is(err, dynamo.ErrConflict) && attempt < maxAttempts {
			continue
		}
		if err != nil {
			return nil, err
		}
		if h.afterChange != nil && len(clientIDs) > 0 {
			return nil, h.afterChange(ctx, clientIDs...)
		}
		return nil, nil
	}
}

// apply reads the items, sets their payments and commits them, returning
// the clients they belong to.
func (h handler) apply(ctx context.Context, in setInput) ([]string, error) {
	now := h.now()
	var ss []sessions.Session
	var ps []packages.Package
	clients := map[string]bool{}

	for _, item := range in.Items {
		switch item.Kind {
		case KindSession:
			s, found, err := h.store.GetSession(ctx, item.ID)
			if err != nil {
				return nil, err
			}
			if !found {
				return nil, sessions.ErrGone
			}
			if err := sessionPayable(s); err != nil {
				return nil, err
			}
			if s.Payment, err = h.payment(in.Payment, item.AmountCents, s.DueCents(), now); err != nil {
				return nil, err
			}
			ss = append(ss, s)
			clients[s.ClientID] = true
		case KindPackage:
			p, found, err := h.store.GetPackage(ctx, item.ID)
			if err != nil {
				return nil, err
			}
			if !found {
				return nil, apperr.NotFound("package not found")
			}
			if p.Receipt != nil {
				return nil, apperr.Conflict("A receipt covers this package. Cancel or discard it first.")
			}
			if p.Payment, err = h.payment(in.Payment, item.AmountCents, p.PriceCents, now); err != nil {
				return nil, err
			}
			ps = append(ps, p)
			clients[p.ClientID] = true
		default:
			return nil, apperr.Invalid("unknown item kind %q", item.Kind)
		}
	}

	if err := h.store.Commit(ctx, ss, ps); err != nil {
		return nil, err
	}
	var ids []string
	for id := range clients {
		if id != "" {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func sessionPayable(s sessions.Session) error {
	switch {
	case s.RemovedAt != nil:
		return apperr.Conflict("Restore the session before changing its payment.")
	case s.Status == sessions.StatusTentative:
		return apperr.Conflict("Confirm the session before recording its payment.")
	case !s.Status.Delivered():
		return apperr.Conflict("Fix the calendar entry before recording its payment.")
	case s.Receipt != nil:
		return apperr.Conflict("A receipt covers this payment. Cancel or discard it first.")
	}
	return nil
}

func (h handler) payment(in *money.Input, amountCents, dueCents int64, now time.Time) (*money.Payment, error) {
	if in == nil {
		return nil, nil
	}
	if amountCents == 0 {
		amountCents = dueCents
	}
	return money.New(*in, amountCents, now, h.loc)
}

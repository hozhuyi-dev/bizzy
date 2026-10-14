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

// Refresh applies what the calendar changed since the last sync on these
// events (sessions, and the packages their titles buy).
type Refresh func(ctx context.Context, eventIDs ...string) error

// Gone reconciles sessions deleted from the calendar whose payment was
// undone: one with nothing else recorded on it goes, as the reconcile
// drops any such session.
type Gone func(ctx context.Context, eventIDs ...string) error

type handler struct {
	store       Store
	afterChange AfterChange
	refresh     Refresh
	gone        Gone
	now         func() time.Time
	loc         *time.Location
}

func Register(r *router.Router, store Store, afterChange AfterChange, refresh Refresh, gone Gone, loc *time.Location, now func() time.Time) {
	h := handler{store: store, afterChange: afterChange, refresh: refresh, gone: gone, now: now, loc: loc}
	r.Mutation("payments.set", router.Typed(h.set))
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
	if err := h.current(ctx, in.Items); err != nil {
		return nil, err
	}

	for attempt := 1; ; attempt++ {
		clientIDs, removed, err := h.apply(ctx, in)
		if errors.Is(err, dynamo.ErrConflict) && attempt < maxAttempts {
			continue
		}
		if err != nil {
			return nil, err
		}
		if h.gone != nil && len(removed) > 0 {
			if err := h.gone(ctx, removed...); err != nil {
				return nil, err
			}
		}
		if h.afterChange != nil && len(clientIDs) > 0 {
			return nil, h.afterChange(ctx, clientIDs...)
		}
		return nil, nil
	}
}

// current applies what the calendar changed on the items since the last
// sync, and refuses when that changes what is due: she pays what she saw,
// and sees the new amount before paying again.
func (h handler) current(ctx context.Context, items []Item) error {
	if h.refresh == nil {
		return nil
	}
	before, err := h.dues(ctx, items)
	if err != nil {
		return err
	}
	ids := make([]string, len(items))
	for i, item := range items {
		ids[i] = item.ID
	}
	if err := h.refresh(ctx, ids...); err != nil {
		return err
	}
	after, err := h.dues(ctx, items)
	if err != nil {
		return err
	}
	for _, item := range items {
		if before[item] != after[item] {
			return apperr.Conflict("The calendar changed this meanwhile: %s is now due. Check it and record the payment again.", money.Format(after[item]))
		}
	}
	return nil
}

// dues is what each item costs now; nothing for one gone.
func (h handler) dues(ctx context.Context, items []Item) (map[Item]int64, error) {
	out := map[Item]int64{}
	for _, item := range items {
		switch item.Kind {
		case KindSession:
			s, _, err := h.store.GetSession(ctx, item.ID)
			if err != nil {
				return nil, err
			}
			out[item] = s.DueCents()
		case KindPackage:
			p, _, err := h.store.GetPackage(ctx, item.ID)
			if err != nil {
				return nil, err
			}
			out[item] = p.PriceCents
		}
	}
	return out, nil
}

// apply reads the items, sets their payments and commits them, returning
// the clients they belong to, and the sessions deleted from the calendar
// whose payment it undid.
func (h handler) apply(ctx context.Context, in setInput) ([]string, []string, error) {
	now := h.now()
	var ss []sessions.Session
	var ps []packages.Package
	clients := map[string]bool{}
	var removed []string

	for _, item := range in.Items {
		switch item.Kind {
		case KindSession:
			s, found, err := h.store.GetSession(ctx, item.ID)
			if err != nil {
				return nil, nil, err
			}
			if !found {
				return nil, nil, sessions.ErrGone
			}
			guard := s.CanPay
			if in.Payment == nil {
				guard = s.CanUndoPayment
			}
			if err := guard(); err != nil {
				return nil, nil, err
			}
			if s.Payment, err = h.payment(in.Payment, item.AmountCents, s.DueCents(), now); err != nil {
				return nil, nil, err
			}
			ss = append(ss, s)
			clients[s.ClientID] = true
			if s.RemovedAt != nil && s.Payment == nil {
				removed = append(removed, s.EventID)
			}
		case KindPackage:
			p, found, err := h.store.GetPackage(ctx, item.ID)
			if err != nil {
				return nil, nil, err
			}
			if !found {
				return nil, nil, apperr.NotFound("package not found")
			}
			if err := p.CanPay(); err != nil {
				return nil, nil, err
			}
			if p.Payment, err = h.payment(in.Payment, item.AmountCents, p.PriceCents, now); err != nil {
				return nil, nil, err
			}
			ps = append(ps, p)
			clients[p.ClientID] = true
		default:
			return nil, nil, apperr.Invalid("unknown item kind %q", item.Kind)
		}
	}

	if err := h.store.Commit(ctx, ss, ps); err != nil {
		return nil, nil, err
	}
	var ids []string
	for id := range clients {
		if id != "" {
			ids = append(ids, id)
		}
	}
	return ids, removed, nil
}

func (h handler) payment(in *money.Input, amountCents, dueCents int64, now time.Time) (*money.Payment, error) {
	if in == nil {
		return nil, nil
	}
	if amountCents == 0 {
		amountCents = dueCents
	}
	return money.New(*in, amountCents, dueCents, now, h.loc)
}

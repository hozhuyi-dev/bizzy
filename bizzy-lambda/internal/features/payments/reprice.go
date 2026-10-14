package payments

import (
	"context"
	"errors"
	"time"

	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/shared/money"
)

// Reprice moves the payments of a session and the package bought in it
// (both by the event's id) to what is due now, when she changed the amount
// in the app and chose to update what was paid with it. The method and day
// stay; one already current, or waived, is left alone. It returns the
// clients whose income changed.
func Reprice(ctx context.Context, store Store, eventID string, now time.Time) ([]string, error) {
	for attempt := 1; ; attempt++ {
		ids, err := reprice(ctx, store, eventID, now)
		if errors.Is(err, dynamo.ErrConflict) && attempt < maxAttempts {
			continue
		}
		return ids, err
	}
}

func reprice(ctx context.Context, store Store, eventID string, now time.Time) ([]string, error) {
	var ss []sessions.Session
	var ps []packages.Package
	var clients []string
	s, found, err := store.GetSession(ctx, eventID)
	if err != nil {
		return nil, err
	}
	if found && s.Payment.Outdated(s.DueCents()) {
		s.Payment = Repriced(s.Payment, s.DueCents(), now)
		ss, clients = append(ss, s), append(clients, s.ClientID)
	}
	p, found, err := store.GetPackage(ctx, eventID)
	if err != nil {
		return nil, err
	}
	if found && p.Payment.Outdated(p.PriceCents) {
		p.Payment = Repriced(p.Payment, p.PriceCents, now)
		ps, clients = append(ps, p), append(clients, p.ClientID)
	}
	if len(ss) == 0 && len(ps) == 0 {
		return nil, nil
	}
	return clients, store.Commit(ctx, ss, ps)
}

// Repriced is a payment received moved to a new amount due: what she
// collected or refunded with the change.
func Repriced(p *money.Payment, dueCents int64, now time.Time) *money.Payment {
	out := *p
	out.AmountCents, out.DueCents, out.UpdatedAt = dueCents, dueCents, now.UTC()
	return &out
}

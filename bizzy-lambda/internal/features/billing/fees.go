package billing

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/shared/docref"
)

// FeeImpactInput is a client's fees as the form has them, before saving.
type FeeImpactInput struct {
	ClientID string            `json:"clientId"`
	FeeRates []clients.FeeRate `json:"feeRates"`
}

// FeeChange is one session whose fee the new rates would change.
type FeeChange struct {
	EventID string    `json:"eventId"`
	Start   time.Time `json:"start"`
	// BeforeCents and AfterCents are its fee now and with the new rates;
	// nil when it has none (no fee set).
	BeforeCents *int64 `json:"beforeCents,omitempty"`
	AfterCents  *int64 `json:"afterCents,omitempty"`
	// Paid says money was received for it, at the fee it has now.
	Paid bool `json:"paid"`
	// Documents are the invoices and receipts covering it ("INV260012", or
	// "draft invoice").
	Documents []string `json:"documents"`
}

// FeeImpact is what saving the rates would reprice.
type FeeImpact struct {
	Changes []FeeChange `json:"changes"`
	// NeedsConfirm says a change touches a session already paid or on a
	// document, or brings on something to fix (see Impact): clients.save
	// refuses the latter unless confirmed.
	NeedsConfirm bool `json:"needsConfirm"`
	// Impact is what saving the rates would bring on.
	Impact Impact `json:"impact"`
}

// FeeImpact prices a client's sessions with their fees now and with the
// rates given, exactly as the reconcile would, and lists the ones that
// differ. Rates that are only new from today on change nothing before.
func (r *Reconciler) FeeImpact(ctx context.Context, in FeeImpactInput) (FeeImpact, error) {
	out := FeeImpact{Changes: []FeeChange{}}
	rates, err := clients.NormalizeFeeRates(in.FeeRates)
	if err != nil {
		return out, err
	}
	cfg, err := r.Settings.Get(ctx)
	if err != nil {
		return out, err
	}
	all, err := r.Clients.List(ctx)
	if err != nil {
		return out, err
	}
	env := NewEnv(all, cfg, r.Location, r.now())
	client, ok := env.Clients[in.ClientID]
	if !ok {
		// A new client has no sessions to reprice.
		if in.ClientID == "" {
			return out, nil
		}
		return out, apperr.NotFound("client not found")
	}
	history, err := r.Sessions.ListByClient(ctx, client.ID)
	if err != nil {
		return out, err
	}
	stored, err := r.Packages.ListByClient(ctx, client.ID)
	if err != nil {
		return out, err
	}

	price := func(c clients.Client) map[string]sessions.Session {
		entries := make([]*Entry, 0, len(history))
		for _, s := range history {
			e := Derive(s, env)
			if e.Session.ClientID == c.ID {
				entries = append(entries, &e)
			}
		}
		pkgs := make([]*packages.Package, len(stored))
		for i := range stored {
			p := stored[i]
			pkgs[i] = &p
		}
		Allocate(c, entries, pkgs, r.Location)
		priced := make(map[string]sessions.Session, len(entries))
		for _, e := range entries {
			priced[e.Session.EventID] = e.Session
		}
		return priced
	}
	before := price(client)
	proposed := client
	proposed.FeeRates = rates
	after := price(proposed)

	for id, a := range after {
		b := before[id]
		if a.Status == b.Status && a.DueCents() == b.DueCents() {
			continue
		}
		change := FeeChange{
			EventID: id, Start: a.Start, BeforeCents: chargedFee(b), AfterCents: chargedFee(a),
			Paid: b.Payment.IsPaid(), Documents: documentLabels(b),
		}
		out.Changes = append(out.Changes, change)
		if change.Paid || len(change.Documents) > 0 {
			out.NeedsConfirm = true
		}
	}
	slices.SortFunc(out.Changes, func(a, b FeeChange) int {
		return cmp.Or(a.Start.Compare(b.Start), cmp.Compare(a.EventID, b.EventID))
	})

	brought, err := r.ClientImpact(ctx, proposed)
	if err != nil {
		return out, err
	}
	out.Impact = ImpactOf(brought)
	out.NeedsConfirm = out.NeedsConfirm || out.Impact.NeedsConfirm
	return out, nil
}

// chargedFee is the session's own fee, nil when it has none.
func chargedFee(s sessions.Session) *int64 {
	if s.Status != sessions.StatusPriced {
		return nil
	}
	return s.FeeCents
}

func documentLabels(s sessions.Session) []string {
	out := []string{}
	for _, slot := range docref.Slots {
		switch ref := s.Ref(slot); {
		case ref.Issued():
			out = append(out, ref.Number)
		case ref != nil:
			out = append(out, fmt.Sprintf("draft %s", slot))
		}
	}
	return out
}

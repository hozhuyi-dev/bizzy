package billing

import (
	"context"
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
)

// PreviewInput is a booking as the form has it, with no amount typed:
// what would pay for it once saved.
type PreviewInput struct {
	ClientID string    `json:"clientId"`
	Start    time.Time `json:"start"`
	// EventID is the session being edited, if any: it keeps what it holds.
	EventID string `json:"eventId,omitempty"`
	// BuysPackage says its title buys a package, whose first credit it uses.
	BuysPackage bool `json:"buysPackage"`
}

type CoverKind string

const (
	CoverNone    CoverKind = "none"
	CoverBought  CoverKind = "bought"
	CoverCredit  CoverKind = "credit"
	CoverDefault CoverKind = "default"
)

// Cover is what pays for a session: a package bought in it, a credit of
// an earlier package, the client's default fee, or nothing known.
type Cover struct {
	Kind      CoverKind `json:"kind"`
	PackageID string    `json:"packageId,omitempty"`
	FeeCents  *int64    `json:"feeCents,omitempty"`
}

// Preview prices a booking exactly as the reconcile will once it is saved:
// Allocate over the client's whole history with the booking in it.
func (r *Reconciler) Preview(ctx context.Context, in PreviewInput) (Cover, error) {
	if in.BuysPackage {
		return Cover{Kind: CoverBought}, nil
	}
	cfg, err := r.Settings.Get(ctx)
	if err != nil {
		return Cover{}, err
	}
	all, err := r.Clients.List(ctx)
	if err != nil {
		return Cover{}, err
	}
	env := NewEnv(all, cfg, r.Location, r.now())
	client, ok := env.Clients[in.ClientID]
	if !ok {
		return Cover{Kind: CoverNone}, nil
	}

	history, err := r.Sessions.ListByClient(ctx, client.ID)
	if err != nil {
		return Cover{}, err
	}
	booking := sessions.Session{EventID: "preview"}
	var entries []*Entry
	for _, s := range history {
		if s.EventID == in.EventID {
			// Editing: what it holds (a payment, a document) still counts.
			booking = s
			continue
		}
		e := Derive(s, env)
		entries = append(entries, &e)
	}
	booking.Title = calendar.FormatTitle(calendar.Title{Name: client.Name})
	booking.Start, booking.End = in.Start.UTC(), in.Start.UTC().Add(time.Hour)
	booking.RemovedAt = nil
	preview := Derive(booking, env)
	entries = append(entries, &preview)

	stored, err := r.Packages.ListByClient(ctx, client.ID)
	if err != nil {
		return Cover{}, err
	}
	var pkgs []*packages.Package
	for _, p := range stored {
		// One its title bought is the form's to say, and it says none.
		if p.ID != in.EventID {
			pkgs = append(pkgs, &p)
		}
	}

	Allocate(client, entries, pkgs)
	switch s := preview.Session; {
	case s.Status == sessions.StatusPackage:
		return Cover{Kind: CoverCredit, PackageID: s.PackageID}, nil
	case s.Status == sessions.StatusPriced:
		return Cover{Kind: CoverDefault, FeeCents: s.FeeCents}, nil
	default:
		return Cover{Kind: CoverNone}, nil
	}
}

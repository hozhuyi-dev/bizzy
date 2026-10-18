package sessions

import (
	"fmt"
	"slices"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// What pays for a session is chosen when it is booked, or when that is
// asked to change (a fee entered or cleared, another client, a package
// bought in it): never again behind the user's back, so a credit or a fee
// the user has seen stays.
//
//  1. a fee entered for it (typed) is its fee;
//  2. otherwise the oldest package of its client with a credit left,
//     bought by its start (one bought in the session itself included);
//  3. otherwise the client's usual fee on its day;
//  4. otherwise nothing, which is refused: enter a fee.
//
// A fee is the session's line on an invoice (see documents); a credit
// leaves it off every invoice.

// FeeChoice is what pays for a session, as entered: a fee typed for it, or
// none (Cents nil), leaving it to a credit or the client's usual fee.
type FeeChoice struct {
	Cents *int64 `json:"cents,omitempty"`
}

// PackageChoice is the package bought in a session (a title's `10x85`),
// or none (Bought nil).
type PackageChoice struct {
	Bought *packages.Bought `json:"bought,omitempty"`
}

// price sets what pays for a session (see above), fee being a fee typed.
func price(tx *txn.Tx, s *Session, fee *int64) error {
	s.PackageID = ""
	if fee != nil {
		if *fee < 0 {
			return apperr.Invalid("A fee can't be negative.")
		}
		return charge(tx, s, *fee, true)
	}
	credit, err := creditFor(tx, s)
	if err != nil {
		return err
	}
	if credit != "" {
		s.PackageID = credit
		return documents.Uncharge(tx, s.Source())
	}
	client, err := clients.Clients.Get(tx, s.ClientID)
	if err != nil {
		return err
	}
	if usual := client.FeeOn(day(tx, s.Start)); usual != nil {
		return charge(tx, s, *usual, false)
	}
	if err := documents.Uncharge(tx, s.Source()); err != nil {
		return err
	}
	return apperr.Refused(fmt.Sprintf("Enter the fee: %s has no usual fee, and no package credit covers this session.", client.Name),
		apperr.Remedy{Action: "clients.update", Target: client.ID, Ask: "fee", Label: fmt.Sprintf("Set %s's usual fee", client.Name)},
		apperr.Remedy{Action: "packages.create", Request: map[string]any{"clientId": client.ID}, Label: fmt.Sprintf("Add a package for %s", client.Name)})
}

// creditFor is the package whose credit would pay for the session: ""
// when none has one left. A credit the session itself holds is its own
// to keep.
func creditFor(tx *txn.Tx, s *Session) (string, error) {
	pkgs, err := packages.Packages.OfClient(tx, s.ClientID)
	if err != nil {
		return "", err
	}
	for _, p := range pkgs {
		if p.PurchasedAt.After(s.Start) {
			continue
		}
		using, err := Sessions.WithRef(tx, p.ID)
		if err != nil {
			return "", err
		}
		used := len(using)
		if slices.ContainsFunc(using, func(u *Session) bool { return u.ID == s.ID }) {
			used--
		}
		if used < p.Sessions {
			return p.ID, nil
		}
	}
	return "", nil
}

// CoverKind is what would pay for a session.
type CoverKind string

const (
	CoverNone    CoverKind = "none"
	CoverBought  CoverKind = "bought"
	CoverCredit  CoverKind = "credit"
	CoverDefault CoverKind = "default"
)

// Preview is what would pay for a session of a client at start with no
// fee entered (sessionID: the one being edited, keeping its own credit),
// for the booking form to show before saving.
func Preview(tx *txn.Tx, clientID string, start time.Time, sessionID string, buysPackage bool) (CoverKind, string, *int64, error) {
	if buysPackage {
		return CoverBought, "", nil, nil
	}
	s := &Session{ID: sessionID, ClientID: clientID, Start: start}
	credit, err := creditFor(tx, s)
	if err != nil || credit != "" {
		return CoverCredit, credit, nil, err
	}
	client, err := clients.Clients.Get(tx, clientID)
	if err != nil {
		return CoverNone, "", nil, err
	}
	if usual := client.FeeOn(day(tx, start)); usual != nil {
		return CoverDefault, "", usual, nil
	}
	return CoverNone, "", nil, nil
}

// charge puts the session's fee on its invoice line, or a new line: on
// the draft invoice of the package bought in it, so they go together.
func charge(tx *txn.Tx, s *Session, cents int64, typed bool) error {
	cfg, err := settings.Get(tx)
	if err != nil {
		return err
	}
	into, err := draftInvoice(tx, documents.PackageSource(boughtID(tx, s.ID)))
	if err != nil {
		return err
	}
	_, err = documents.SetCharge(tx, documents.Charge{
		ClientID: s.ClientID, Source: s.Source(), Description: cfg.ServiceName,
		Date: day(tx, s.Start), Cents: cents, Typed: typed, Into: into,
	})
	return err
}

// Fee is what a session's invoice charges, and whether that fee was typed
// for it; 0 and false on a credit.
func Fee(tx *txn.Tx, s *Session) (int64, bool, error) {
	_, line, err := documents.Invoice(tx, s.Source())
	if err != nil || line == nil {
		return 0, false, err
	}
	return line.AmountCents, line.Typed, nil
}

// draftInvoice is the never-issued invoice an item is on, for what is
// bought with it to join; "" when none.
func draftInvoice(tx *txn.Tx, src documents.Source) (string, error) {
	d, _, err := documents.Invoice(tx, src)
	if err != nil || d == nil || d.Issued() {
		return "", err
	}
	return d.ID, nil
}

// boughtID is the id of the package bought in a session; "" when none.
func boughtID(tx *txn.Tx, sessionID string) string {
	p, _ := packages.BoughtIn(tx, sessionID)
	if p == nil {
		return ""
	}
	return p.ID
}

// boughtSpec is the package bought in a session as its booking says it.
func boughtSpec(tx *txn.Tx, p *packages.Package) (*packages.Bought, error) {
	price, _, err := documents.Charged(tx, documents.PackageSource(p.ID))
	return &packages.Bought{Sessions: p.Sessions, PriceCents: price}, err
}

// owed is what is still owed on a session: its fee unless received, and
// the package bought in it unless paid.
func owed(tx *txn.Tx, s *Session) (int64, error) {
	var total int64
	for _, src := range []documents.Source{s.Source(), documents.PackageSource(boughtID(tx, s.ID))} {
		if src.ID == "" {
			continue
		}
		cents, _, err := documents.Charged(tx, src)
		if err != nil {
			return 0, err
		}
		paid, err := documents.Received(tx, src)
		if err != nil {
			return 0, err
		}
		if paid == nil {
			total += cents
		}
	}
	return total, nil
}

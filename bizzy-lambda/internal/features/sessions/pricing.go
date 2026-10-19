package sessions

import (
	"fmt"
	"strings"
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
// bought in it, a length charged differently): never again behind the
// user's back, so credits or a fee the user has seen stay.
//
// A session is charged for its length rounded down to a half hour, and
// at least a half hour (Billable):
//
//  1. a fee entered for it (typed) is its whole fee;
//  2. otherwise its client's packages bought by its start (one bought in
//     the session itself included) pay with the credits they have left,
//     oldest first, an hour a credit, a half hour at a time;
//  3. what they leave is charged at the client's usual hourly fee on its
//     day;
//  4. without one, that is refused: enter a fee.
//
// A fee is the session's line on an invoice (see documents); a session
// its credits pay for in full is on no invoice.

// FeeChoice is what pays for a session, as entered: a fee typed for it, or
// none (Cents nil), leaving it to credits and the client's usual fee.
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
	s.Credits = nil
	if fee != nil {
		if *fee < 0 {
			return apperr.Invalid("A fee can't be negative.")
		}
		return charge(tx, s, *fee, true, s.Billable())
	}
	credits, err := creditsFor(tx, s.ID, s.ClientID, s.Start, s.Billable())
	if err != nil {
		return err
	}
	s.Credits = credits
	left := s.Billable() - s.CreditMinutes()
	if left == 0 {
		return documents.Uncharge(tx, s.Source())
	}
	client, err := clients.Clients.Get(tx, s.ClientID)
	if err != nil {
		return err
	}
	if rate := client.FeeOn(day(tx, s.Start)); rate != nil {
		return charge(tx, s, Hourly(*rate, left), false, left)
	}
	if err := documents.Uncharge(tx, s.Source()); err != nil {
		return err
	}
	covered := "no package credit covers this session"
	if len(credits) > 0 {
		covered = fmt.Sprintf("package credits cover only %s of this session", packages.Hours(s.CreditMinutes()))
	}
	return apperr.Refused(fmt.Sprintf("Enter the fee: %s has no usual fee, and %s.", client.Name, covered),
		apperr.Remedy{Action: "clients.update", Target: client.ID, Ask: "fee", Label: fmt.Sprintf("Set %s's usual fee", client.Name)},
		apperr.Remedy{Action: "packages.create", Request: map[string]any{"clientId": client.ID}, Label: fmt.Sprintf("Add a package for %s", client.Name)})
}

// Hourly is what an hourly rate charges for minutes, to the nearest cent
// (a half cent up).
func Hourly(rateCents int64, minutes int) int64 {
	return (rateCents*int64(minutes) + 30) / 60
}

// creditsFor is the credits that would pay for minutes of a session of a
// client at start (sessionID: the one being priced, whose own credits are
// its to keep): from each package bought by then with credits left,
// oldest first, until they pay it all or run out.
func creditsFor(tx *txn.Tx, sessionID, clientID string, start time.Time, minutes int) ([]Credit, error) {
	pkgs, err := packages.Packages.OfClient(tx, clientID)
	if err != nil {
		return nil, err
	}
	used, err := usedByOthers(tx, clientID, sessionID)
	if err != nil {
		return nil, err
	}
	var out []Credit
	for _, p := range pkgs {
		if minutes == 0 {
			break
		}
		if p.PurchasedAt.After(start) {
			continue
		}
		if take := min(p.Hours*60-used[p.ID], minutes); take > 0 {
			out = append(out, Credit{PackageID: p.ID, Minutes: take})
			minutes -= take
		}
	}
	return out, nil
}

// usedByOthers is how many minutes of each of a client's packages their
// sessions but one use.
func usedByOthers(tx *txn.Tx, clientID, sessionID string) (map[string]int, error) {
	ss, err := Sessions.OfClient(tx, clientID)
	if err != nil {
		return nil, err
	}
	used := map[string]int{}
	for _, o := range ss {
		if o.ID == sessionID {
			continue
		}
		for _, c := range o.Credits {
			used[c.PackageID] += c.Minutes
		}
	}
	return used, nil
}

// CoverKind is what would pay for what a session's credits leave.
type CoverKind string

const (
	// CoverNone: nothing, so a fee must be entered.
	CoverNone CoverKind = "none"
	// CoverBought: the package bought in it.
	CoverBought CoverKind = "bought"
	// CoverCredit: nothing is left; credits pay for it all.
	CoverCredit CoverKind = "credit"
	// CoverDefault: the client's usual fee.
	CoverDefault CoverKind = "default"
)

// Cover is what would pay for a session.
type Cover struct {
	Kind CoverKind
	// Minutes is how long it is charged for (Billable).
	Minutes int
	// Credits are the credits of packages bought before it that pay.
	Credits []Credit
	// FeeMinutes is what they leave, which FeeCents charges at the
	// usual fee (nil without one, or when the bought package pays).
	FeeMinutes int
	FeeCents   *int64
}

// Preview is what would pay for a session of a client over span with no
// fee entered (sessionID: the one being edited, keeping its own credits),
// for the booking form to show before saving.
func Preview(tx *txn.Tx, clientID string, span Span, sessionID string, buysPackage bool) (Cover, error) {
	s := &Session{ID: sessionID, ClientID: clientID, Start: span.Start, End: span.End}
	credits, err := creditsFor(tx, s.ID, clientID, s.Start, s.Billable())
	s.Credits = credits
	c := Cover{Kind: CoverCredit, Minutes: s.Billable(), Credits: credits, FeeMinutes: s.Billable() - s.CreditMinutes()}
	switch {
	case err != nil || c.FeeMinutes == 0:
		return c, err
	case buysPackage:
		c.Kind = CoverBought
		return c, nil
	}
	client, err := clients.Clients.Get(tx, clientID)
	if err != nil {
		return c, err
	}
	c.Kind = CoverNone
	if rate := client.FeeOn(day(tx, s.Start)); rate != nil {
		fee := Hourly(*rate, c.FeeMinutes)
		c.Kind, c.FeeCents = CoverDefault, &fee
	}
	return c, nil
}

// charge puts the session's fee for minutes of it on its invoice line, or
// a new line: on the draft invoice of the package bought in it, so they
// go together.
func charge(tx *txn.Tx, s *Session, cents int64, typed bool, minutes int) error {
	cfg, err := settings.Get(tx)
	if err != nil {
		return err
	}
	into, err := draftInvoice(tx, documents.PackageSource(boughtID(tx, s.ID)))
	if err != nil {
		return err
	}
	desc := cfg.ServiceName
	if !typed {
		desc += " (" + packages.Hours(minutes) + ")"
	}
	if _, line, err := documents.Invoice(tx, s.Source()); err != nil {
		return err
	} else if line != nil && line.Description != desc && ownDescription(cfg, line.Description) {
		if err := documents.Redescribe(tx, s.Source(), line.Description, desc); err != nil {
			return err
		}
	}
	_, err = documents.SetCharge(tx, documents.Charge{
		ClientID: s.ClientID, Source: s.Source(), Description: desc,
		Date: day(tx, s.Start), Cents: cents, Typed: typed, Into: into,
	})
	return err
}

// ownDescription reports whether a session's line says what charge wrote,
// not something the user wrote, which stays.
func ownDescription(cfg settings.Settings, desc string) bool {
	hours, ok := strings.CutPrefix(desc, cfg.ServiceName)
	return ok && (hours == "" || strings.HasPrefix(hours, " (") && strings.HasSuffix(hours, " h)"))
}

// Fee is what a session's invoice charges, and whether that fee was typed
// for it; 0 and false when its credits pay for it all.
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
	return &packages.Bought{Hours: p.Hours, PriceCents: price}, err
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

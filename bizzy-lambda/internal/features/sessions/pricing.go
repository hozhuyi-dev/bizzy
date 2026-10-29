package sessions

import (
	"cmp"
	"fmt"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// How a session is paid for is chosen, and kept (Pay): by package
// credits or by its own fee. A new session is paid by package when its
// client has credits it may use then (or buys a package in it), else by
// its fee, and so is one whose typed fee is cleared (the calendar's title
// losing its amount); the user may switch it, and pick the package. What
// pays is worked out again only when that is asked to change (a choice
// made, a fee entered or cleared, another client, a package bought in
// it, a length charged differently), the same way, so credits never take
// over a fee, or a fee credits, behind the user's back.
//
// A session is charged for its length rounded down to a half hour, and
// at least a half hour (Billable):
//
//  1. paid by its fee, a fee entered for it (typed) is its whole fee,
//     else the client's usual hourly fee is;
//  2. paid by package, the package chosen pays first with the credits it
//     has left, whenever it was bought; then the packages its client may
//     use (their own, and those shared with them) bought by its start
//     (one bought in the session itself included), oldest first, an hour
//     a credit, a half hour at a time;
//  3. what they leave is charged at the client's usual hourly fee, as it
//     is when the session is priced;
//  4. without one, that is refused: enter a fee.
//
// A fee is the session's line on an invoice (see documents); a session
// its credits pay for in full is on no invoice. How a session is paid
// changes only while nothing is received for it and no issued document
// covers it (CanChangePay): a session paid stays paid as it was.

// PayBy is what a session is paid by.
type PayBy string

const (
	PayByPackage PayBy = "package"
	PayByFee     PayBy = "fee"
)

// Pay is how a session is paid for: by package credits, from the package
// chosen first (PackageID; "" for the oldest), or by its own fee.
type Pay struct {
	By        PayBy  `json:"by"`
	PackageID string `json:"packageId,omitempty"`
}

// FeeChoice is a fee typed for a session, paid by it; or none (Cents
// nil), leaving how it is paid to the default (see above).
type FeeChoice struct {
	Cents *int64 `json:"cents,omitempty"`
}

// PackageChoice is the package bought in a session (a title's `10x85`),
// or none (Bought nil).
type PackageChoice struct {
	Bought *packages.Bought `json:"bought,omitempty"`
}

// price sets what pays for a session as its Pay says (see above), fee
// being a fee typed, for one paid by its fee.
func price(tx *txn.Tx, s *Session, fee *int64) error {
	s.Credits = nil
	if fee != nil {
		if *fee < 0 {
			return apperr.Invalid("A fee can't be negative.")
		}
		return charge(tx, s, *fee, true)
	}
	left := s.Billable()
	if s.Pay.By == PayByPackage {
		credits, err := creditsFor(tx, s.ID, s.ClientID, s.Start, s.Billable(), s.Pay.PackageID)
		if err != nil {
			return err
		}
		s.Credits = credits
		left -= s.CreditMinutes()
		if left == 0 {
			return documents.Uncharge(tx, s.Source())
		}
	}
	client, err := clients.Clients.Get(tx, s.ClientID)
	if err != nil {
		return err
	}
	if rate := client.FeeCents; rate != nil {
		return charge(tx, s, Hourly(*rate, left), false)
	}
	if err := documents.Uncharge(tx, s.Source()); err != nil {
		return err
	}
	setFee := apperr.Remedy{Action: "clients.update", Target: client.ID, Ask: "fee", Label: fmt.Sprintf("Set %s's usual fee", client.Name)}
	if s.Pay.By == PayByFee {
		return apperr.Refused(fmt.Sprintf("Enter the fee: %s has no usual fee.", client.Name), setFee)
	}
	covered := "no package credit covers this session"
	if len(s.Credits) > 0 {
		covered = fmt.Sprintf("package credits cover only %s of this session", packages.Hours(s.CreditMinutes()))
	}
	return apperr.Refused(fmt.Sprintf("Enter the fee: %s has no usual fee, and %s.", client.Name, covered), setFee,
		apperr.Remedy{Action: "packages.create", Request: map[string]any{"clientId": client.ID}, Label: fmt.Sprintf("Add a package for %s", client.Name)})
}

// defaultPay is how a session is paid for until the user says: by package
// when its client has credits it may use then, or buys a package in it,
// else by its fee.
func defaultPay(tx *txn.Tx, s *Session) (Pay, error) {
	if boughtID(tx, s.ID) != "" {
		return Pay{By: PayByPackage}, nil
	}
	credits, err := creditsFor(tx, s.ID, s.ClientID, s.Start, s.Billable(), "")
	if err != nil || len(credits) == 0 {
		return Pay{By: PayByFee}, err
	}
	return Pay{By: PayByPackage}, nil
}

// choosePay sets how a session is paid for, as f asks: as chosen (Pay); by
// its fee once one is typed; as defaultPay says for a new one, one whose
// typed fee is cleared, or one a package was bought in or is no longer.
// A package chosen that its client may no longer use (it went, or the
// session is another client's) is forgotten. A change to what was chosen
// must be one CanChangePay allows.
func choosePay(tx *txn.Tx, s *Session, f Fields, isNew, bought bool) error {
	was := s.Pay
	typed := f.Fee != nil && f.Fee.Cents != nil
	switch {
	case f.Pay != nil:
		if err := checkPay(tx, s, *f.Pay); err != nil {
			return err
		}
		if typed && f.Pay.By != PayByFee {
			return apperr.Invalid("A fee is typed only for a session paid by its fee.")
		}
		s.Pay = *f.Pay
	case typed:
		s.Pay = Pay{By: PayByFee}
	case isNew || f.Fee != nil || bought:
		p, err := defaultPay(tx, s)
		if err != nil {
			return err
		}
		s.Pay = p
	}
	if s.Pay.PackageID != "" {
		p, ok, err := packages.Packages.Find(tx, s.Pay.PackageID)
		if err != nil {
			return err
		}
		if !ok || !p.UsableBy(s.ClientID) {
			s.Pay.PackageID = ""
		}
	}
	if isNew || s.Pay.By == was.By && (f.Pay == nil || f.Pay.PackageID == was.PackageID) {
		return nil
	}
	return CanChangePay(tx, s)
}

// checkPay is the refusal for a choice of how a session is paid: by
// package or fee, and a package chosen only to pay by, one its client may
// use.
func checkPay(tx *txn.Tx, s *Session, pay Pay) error {
	switch {
	case pay.By != PayByPackage && pay.By != PayByFee:
		return apperr.Invalid("A session is paid by package or by its fee.")
	case pay.PackageID == "":
		return nil
	case pay.By != PayByPackage:
		return apperr.Invalid("A package is chosen only for a session paid by package.")
	}
	p, err := packages.Packages.Get(tx, pay.PackageID)
	if err != nil {
		return err
	}
	if !p.UsableBy(s.ClientID) {
		return apperr.Refused(fmt.Sprintf("That package isn't %s's, or shared with them.", clientName(tx, s.ClientID)))
	}
	return nil
}

// CanChangePay is the refusal for changing how a session is paid for: no
// issued invoice or receipt covers it (see CanReprice), and nothing is
// received for it, since a session paid stays paid as it was.
func CanChangePay(tx *txn.Tx, s *Session) error {
	if err := CanReprice(tx, s); err != nil {
		return err
	}
	paid, err := documents.Received(tx, s.Source())
	if err != nil || paid == nil {
		return err
	}
	return apperr.Refused(fmt.Sprintf("%s was received for it, so it stays paid as it was. Undo the payment first.", documents.Format(paid.AmountCents)),
		documents.UndoPayment(s.Source()))
}

// Hourly is what an hourly rate charges for minutes, to the nearest cent
// (a half cent up).
func Hourly(rateCents int64, minutes int) int64 {
	return (rateCents*int64(minutes) + 30) / 60
}

// creditsFor is the credits that would pay for minutes of a session of a
// client at start (sessionID: the one being priced, whose own credits are
// its to keep): from the package chosen first, whenever it was bought,
// then each package the client may use, bought by then with credits left,
// oldest first, until they pay it all or run out.
func creditsFor(tx *txn.Tx, sessionID, clientID string, start time.Time, minutes int, chosen string) ([]Credit, error) {
	all, err := packages.Packages.All(tx)
	if err != nil {
		return nil, err
	}
	var pkgs []*packages.Package
	for _, p := range all {
		if p.UsableBy(clientID) {
			pkgs = append(pkgs, p)
		}
	}
	slices.SortFunc(pkgs, func(a, b *packages.Package) int {
		return cmp.Or(cmp.Compare(txn.TimeKey(a.PurchasedAt), txn.TimeKey(b.PurchasedAt)), cmp.Compare(a.ID, b.ID))
	})
	// The one chosen goes first, however late it was bought.
	if i := slices.IndexFunc(pkgs, func(p *packages.Package) bool { return p.ID == chosen }); i > 0 {
		p := pkgs[i]
		pkgs = slices.Insert(slices.Delete(pkgs, i, i+1), 0, p)
	}
	used, err := usedByOthers(tx, pkgs, sessionID)
	if err != nil {
		return nil, err
	}
	var out []Credit
	for _, p := range pkgs {
		if minutes == 0 {
			break
		}
		if p.PurchasedAt.After(start) && p.ID != chosen {
			continue
		}
		if take := min(p.Hours*60-used[p.ID], minutes); take > 0 {
			out = append(out, Credit{PackageID: p.ID, Minutes: take})
			minutes -= take
		}
	}
	return out, nil
}

// usedByOthers is how many minutes of each of packages the sessions of
// their clients but one use.
func usedByOthers(tx *txn.Tx, pkgs []*packages.Package, sessionID string) (map[string]int, error) {
	read := map[string]bool{}
	used := map[string]int{}
	for _, p := range pkgs {
		for _, clientID := range p.Clients() {
			if read[clientID] {
				continue
			}
			read[clientID] = true
			ss, err := Sessions.OfClient(tx, clientID)
			if err != nil {
				return nil, err
			}
			for _, o := range ss {
				if o.ID == sessionID {
					continue
				}
				for _, c := range o.Credits {
					used[c.PackageID] += c.Minutes
				}
			}
		}
	}
	return used, nil
}

// PayOption is a package a session could be paid by: whose it is, when it
// was bought, and the hours it has left for the session (its own credits
// counted back in).
type PayOption struct {
	PackageID   string    `json:"packageId"`
	ClientID    string    `json:"clientId"`
	PurchasedAt time.Time `json:"purchasedAt"`
	HoursLeft   float64   `json:"hoursLeft"`
	// After says it was bought after the session started: it pays only
	// once chosen.
	After bool `json:"after"`
}

// payOptions are the packages a session could be paid by, oldest first:
// those its client may use with hours left for it, and any it uses or
// has chosen.
func payOptions(tx *txn.Tx, s *Session) ([]PayOption, error) {
	all, err := packages.Packages.All(tx)
	if err != nil {
		return nil, err
	}
	var pkgs []*packages.Package
	for _, p := range all {
		if p.UsableBy(s.ClientID) {
			pkgs = append(pkgs, p)
		}
	}
	used, err := usedByOthers(tx, pkgs, s.ID)
	if err != nil {
		return nil, err
	}
	slices.SortFunc(pkgs, func(a, b *packages.Package) int {
		return cmp.Or(cmp.Compare(txn.TimeKey(a.PurchasedAt), txn.TimeKey(b.PurchasedAt)), cmp.Compare(a.ID, b.ID))
	})
	out := []PayOption{}
	for _, p := range pkgs {
		left := p.Hours*60 - used[p.ID]
		mine := p.ID == s.Pay.PackageID || slices.ContainsFunc(s.Credits, func(c Credit) bool { return c.PackageID == p.ID })
		if left <= 0 && !mine {
			continue
		}
		out = append(out, PayOption{
			PackageID: p.ID, ClientID: p.ClientID, PurchasedAt: p.PurchasedAt,
			HoursLeft: hours(max(left, 0)), After: p.PurchasedAt.After(s.Start),
		})
	}
	return out, nil
}

// Movable are the sessions a package could pay for that their own fee
// does now, latest first: those of the clients it is for, not cancelled.
// Each says whether its payment can change (CanChangePay).
func Movable(tx *txn.Tx, packageID string) ([]*Session, error) {
	p, err := packages.Packages.Get(tx, packageID)
	if err != nil {
		return nil, err
	}
	var out []*Session
	for _, clientID := range p.Clients() {
		ss, err := Sessions.OfClient(tx, clientID)
		if err != nil {
			return nil, err
		}
		for _, s := range ss {
			if !s.Cancelled() && s.Pay.By == PayByFee {
				out = append(out, s)
			}
		}
	}
	slices.SortFunc(out, func(a, b *Session) int { return cmp.Or(b.Start.Compare(a.Start), cmp.Compare(a.ID, b.ID)) })
	return out, nil
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
	// By is how it would be paid: as chosen, else as it would be by
	// default (see defaultPay).
	By   PayBy
	Kind CoverKind
	// Minutes is how long it is charged for (Billable).
	Minutes int
	// Credits are the package credits that pay, paid by package.
	Credits []Credit
	// FeeMinutes is what they leave, which FeeCents charges at the
	// usual fee (nil without one, or when the bought package pays).
	FeeMinutes int
	FeeCents   *int64
}

// Preview is what would pay for a session of a client over span with no
// fee entered, paid as pay says (nil: as it would be by default), for the
// booking form to show before saving. sessionID is the one being edited,
// keeping its own credits.
func Preview(tx *txn.Tx, clientID string, span Span, sessionID string, buysPackage bool, pay *Pay) (Cover, error) {
	s := &Session{ID: sessionID, ClientID: clientID, Start: span.Start, End: span.End}
	c := Cover{Kind: CoverCredit, Minutes: s.Billable()}
	switch {
	case pay != nil:
		s.Pay = *pay
	case buysPackage:
		s.Pay = Pay{By: PayByPackage}
	default:
		p, err := defaultPay(tx, s)
		if err != nil {
			return c, err
		}
		s.Pay = p
	}
	c.By = s.Pay.By
	if s.Pay.By == PayByPackage {
		credits, err := creditsFor(tx, s.ID, clientID, s.Start, s.Billable(), s.Pay.PackageID)
		if err != nil {
			return c, err
		}
		s.Credits, c.Credits = credits, credits
	}
	c.FeeMinutes = s.Billable() - s.CreditMinutes()
	switch {
	case c.FeeMinutes == 0:
		return c, nil
	case buysPackage && s.Pay.By == PayByPackage:
		c.Kind = CoverBought
		return c, nil
	}
	client, err := clients.Clients.Get(tx, clientID)
	if err != nil {
		return c, err
	}
	c.Kind = CoverNone
	if rate := client.FeeCents; rate != nil {
		fee := Hourly(*rate, c.FeeMinutes)
		c.Kind, c.FeeCents = CoverDefault, &fee
	}
	return c, nil
}

// charge puts the session's fee on its invoice line, or a new line on the
// draft invoiceInto picks.
func charge(tx *txn.Tx, s *Session, cents int64, typed bool) error {
	cfg, err := settings.Get(tx)
	if err != nil {
		return err
	}
	into, err := invoiceInto(tx, s)
	if err != nil {
		return err
	}
	// The service alone, however long the session: its time is on the line's date.
	desc := cfg.ServiceName
	if _, line, err := documents.Invoice(tx, s.Source()); err != nil {
		return err
	} else if line != nil && line.Description != desc && ownDescription(cfg, line.Description) {
		if err := documents.Redescribe(tx, s.Source(), line.Description, desc); err != nil {
			return err
		}
	}
	_, err = documents.SetCharge(tx, documents.Charge{
		For: s.ClientID, Source: s.Source(), Description: desc,
		Date: day(tx, s.Start), Cents: cents, Typed: typed, Into: into,
	})
	return err
}

// ownDescription reports whether a session's line says what charge wrote,
// not something the user wrote, which stays: the service, or the service
// and its hours as lines once said ("Physiotherapy session (1.5 h)").
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

// invoiceInto is the draft invoice a session's fee goes on when it has no
// line yet: the one the package bought in it is on, so they go together;
// "" for a new one. It is the one place this is chosen, so invoicing by
// the month puts the session on its client's draft for its month here
// (documents' Period), and Redate moves it with documents.Place.
func invoiceInto(tx *txn.Tx, s *Session) (string, error) {
	return draftInvoice(tx, documents.PackageSource(boughtID(tx, s.ID)))
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

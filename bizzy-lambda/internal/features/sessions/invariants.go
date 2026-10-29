package sessions

import (
	"fmt"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/platform/txn"
)

// Invariants are what holds for every session, always, and for what it is
// tied to: the actions refuse what would break them; these catch one that
// doesn't. A rule between two kinds is written from both sides, so a
// commit that changes either is checked.
var Invariants = []txn.Invariant{
	{
		ID: "sessions-never-overlap", Why: "The user sees one client at a time",
		On: Sessions.Name,
		Broken: each(func(tx *txn.Tx, s *Session) ([]string, error) {
			o, err := overlapping(tx, *s)
			if o != nil {
				return []string{fmt.Sprintf("session %s overlaps session %s", s.ID, o.ID)}, err
			}
			return nil, err
		}),
	},
	{
		ID: "sessions-last-a-while", Why: "A session ends after it starts, within a day's work, at a place",
		On: Sessions.Name,
		Broken: each(func(tx *txn.Tx, s *Session) ([]string, error) {
			if bad := validSpan(Span{s.Start, s.End}); bad != nil {
				return []string{fmt.Sprintf("session %s: %v", s.ID, bad)}, nil
			}
			if s.Location != LocationOwn && s.Location != LocationVisit {
				return []string{fmt.Sprintf("session %s is at %q", s.ID, s.Location)}, nil
			}
			return nil, nil
		}),
	},
	{
		ID: "sessions-are-a-clients", Why: "Every session is a client's",
		On: Sessions.Name,
		Broken: each(func(tx *txn.Tx, s *Session) ([]string, error) {
			if _, found, err := clients.Clients.Find(tx, s.ClientID); err != nil || !found {
				return []string{fmt.Sprintf("session %s is for %q, who isn't a client", s.ID, s.ClientID)}, err
			}
			return nil, nil
		}),
	},
	{
		ID: "clients-keep-their-sessions", Why: "A client with sessions isn't deleted",
		On: clients.Clients.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			if _, ok, err := clients.Clients.Find(tx, id); err != nil || ok {
				return nil, err
			}
			if has, err := Sessions.HasClient(tx, id); err != nil || has {
				return []string{"client " + id + " was deleted with sessions"}, err
			}
			return nil, nil
		},
	},
	{
		ID: "paid-for", Why: paidForWhy,
		On: Sessions.Name, Broken: each(paidFor),
	},
	{
		// A commit that changes only documents is checked from their side.
		ID: "paid-for", Why: paidForWhy,
		On: documents.Links.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			if src, t, ok := documents.LinkSource(id); ok && t == documents.TypeInvoice && src.Kind == documents.SourceSession {
				return each(paidFor)(tx, src.ID)
			}
			return nil, nil
		},
	},
	{
		ID: "cancelled-costs-nothing", Why: cancelledWhy,
		On: Sessions.Name, Broken: each(costsNothing),
	},
	{
		// A commit that changes only documents is checked from their side.
		ID: "cancelled-costs-nothing", Why: cancelledWhy,
		On: documents.Links.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			if src, _, ok := documents.LinkSource(id); ok && src.Kind == documents.SourceSession {
				return each(costsNothing)(tx, src.ID)
			}
			return nil, nil
		},
	},
	{
		ID: "credits-of-own-package", Why: "Credits pay for a session from packages its client may use (their own, or shared with them), each once",
		On: Sessions.Name,
		Broken: each(func(tx *txn.Tx, s *Session) ([]string, error) {
			seen := map[string]bool{}
			for _, c := range s.Credits {
				p, ok, err := packages.Packages.Find(tx, c.PackageID)
				switch {
				case err != nil:
					return nil, err
				case seen[c.PackageID]:
					return []string{fmt.Sprintf("session %s uses package %s twice", s.ID, c.PackageID)}, nil
				case !ok:
					return []string{fmt.Sprintf("session %s uses credits of %s, which doesn't exist", s.ID, c.PackageID)}, nil
				case !p.UsableBy(s.ClientID):
					return []string{fmt.Sprintf("session %s of %s uses %s's package %s", s.ID, s.ClientID, p.ClientID, p.ID)}, nil
				}
				seen[c.PackageID] = true
			}
			return nil, nil
		}),
	},
	{
		ID: "paid-as-chosen", Why: "A session is paid by package or by its fee, as chosen: one paid by its fee uses no package credits",
		On: Sessions.Name,
		Broken: each(func(tx *txn.Tx, s *Session) ([]string, error) {
			switch {
			case s.Pay.By != PayByPackage && s.Pay.By != PayByFee:
				return []string{fmt.Sprintf("session %s is paid by %q", s.ID, s.Pay.By)}, nil
			case s.Pay.By == PayByFee && len(s.Credits) > 0:
				return []string{fmt.Sprintf("session %s is paid by its fee and uses package credits", s.ID)}, nil
			case s.Pay.By == PayByFee && s.Pay.PackageID != "":
				return []string{fmt.Sprintf("session %s is paid by its fee with package %s chosen", s.ID, s.Pay.PackageID)}, nil
			}
			return nil, nil
		}),
	},
	{
		ID: "credits-in-hand", Why: "Sessions use no more of a package's credits than it has, and a package used isn't deleted",
		On: packages.Packages.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			u, err := CreditsUsed(tx, id)
			if err != nil {
				return nil, err
			}
			used := u.Minutes()
			p, ok, err := packages.Packages.Find(tx, id)
			switch {
			case err != nil:
				return nil, err
			case !ok && used > 0:
				return []string{fmt.Sprintf("package %s was deleted while sessions use %d minutes of it", id, used)}, nil
			case ok && used > p.Hours*60:
				return []string{fmt.Sprintf("package %s has %d hours and sessions use %d minutes", id, p.Hours, used)}, nil
			}
			return nil, nil
		},
	},
	{
		ID: "credits-in-hand", Why: "Sessions use no more of a package's credits than it has, and a package used isn't deleted",
		On: Sessions.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			s, ok, err := Sessions.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			var out []string
			for _, c := range s.Credits {
				p, ok, err := packages.Packages.Find(tx, c.PackageID)
				if err != nil || !ok {
					return nil, err // credits-of-own-package says it.
				}
				if u, err := CreditsUsed(tx, p.ID); err != nil {
					return nil, err
				} else if used := u.Minutes(); used > p.Hours*60 {
					out = append(out, fmt.Sprintf("package %s has %d hours and sessions use %d minutes", p.ID, p.Hours, used))
				}
			}
			return out, nil
		},
	},
	{
		ID: "confirmed-before-invoiced", Why: "An invoice is issued, and a payment recorded, for a confirmed session only",
		On: Sessions.Name,
		Broken: each(func(tx *txn.Tx, s *Session) ([]string, error) {
			if !s.Tentative {
				return nil, nil
			}
			inv, _, err := documents.Invoice(tx, s.Source())
			if err != nil {
				return nil, err
			}
			paid, err := documents.Received(tx, s.Source())
			if inv != nil && inv.Issued() || paid != nil {
				return []string{"tentative session " + s.ID + " is invoiced or paid"}, err
			}
			return nil, err
		}),
	},
	{
		ID: "session-lines-are-its-clients", Why: "A document's line for a session is for the session's client, whoever pays, and an issued invoice's sessions are confirmed",
		On: documents.Documents.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			d, ok, err := documents.Documents.Find(tx, id)
			if err != nil || !ok || d.Counting() == nil {
				return nil, err
			}
			var out []string
			for _, line := range d.Counting().Lines {
				if line.Source == nil || line.Source.Kind != documents.SourceSession {
					continue
				}
				s, found, err := Sessions.Find(tx, line.Source.ID)
				switch {
				case err != nil:
					return nil, err
				case !found:
					out = append(out, fmt.Sprintf("%s %s covers session %s, which doesn't exist", d.Type, id, line.Source.ID))
				case s.Cancelled():
					out = append(out, fmt.Sprintf("%s %s covers session %s, which was cancelled", d.Type, id, s.ID))
				case s.ClientID != d.ForClient(line):
					out = append(out, fmt.Sprintf("%s %s's line for %s covers %s's session %s", d.Type, id, d.ForClient(line), s.ClientID, s.ID))
				case s.Tentative && d.Issued() && d.Type == documents.TypeInvoice:
					out = append(out, fmt.Sprintf("%s covers tentative session %s", d.Number, s.ID))
				}
			}
			return out, nil
		},
	},
	{
		ID: "bought-in-its-session", Why: "A package bought in a session is that session's client's, bought on its day",
		On: packages.Packages.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			p, ok, err := packages.Packages.Find(tx, id)
			if err != nil || !ok || p.BoughtIn == "" {
				return nil, err
			}
			return boughtFollows(tx, p)
		},
	},
	{
		ID: "bought-in-its-session", Why: "A package bought in a session is that session's client's, bought on its day",
		On: Sessions.Name,
		Broken: each(func(tx *txn.Tx, s *Session) ([]string, error) {
			p, err := packages.BoughtIn(tx, s.ID)
			if err != nil || p == nil {
				return nil, err
			}
			return boughtFollows(tx, p)
		}),
	},
	{
		ID: "records-are-a-sessions", Why: "Notes and files are a session's, and go with it",
		On: Sessions.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			if _, ok, err := Sessions.Find(tx, id); err != nil || ok {
				return nil, err
			}
			if _, ok, err := Notes.Find(tx, id); err != nil || ok {
				return []string{"deleted session " + id + " left its notes"}, err
			}
			if n, err := attachments.Count(tx, attachments.OwnerSession, id); err != nil || n > 0 {
				return []string{"deleted session " + id + " left its files"}, err
			}
			return nil, nil
		},
	},
	{
		ID: "records-are-a-sessions", Why: "Notes and files are a session's, and go with it",
		On: attachments.Attachments.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			a, ok, err := attachments.Attachments.Find(tx, id)
			if err != nil || !ok || a.OwnerKind != attachments.OwnerSession {
				return nil, err
			}
			if _, found, err := Sessions.Find(tx, a.OwnerID); err != nil || !found {
				return []string{fmt.Sprintf("file %s is attached to session %s, which doesn't exist", id, a.OwnerID)}, err
			}
			return nil, nil
		},
	},
}

const paidForWhy = "Credits pay for a session by the half hour, its fee on an invoice for what they leave: all of it, never more"

const cancelledWhy = "A cancelled session costs nothing: no credits, no invoice or receipt, no package bought in it"

// paidFor is what breaks a session being paid for (see paidForWhy); a
// cancelled one is paid for by nothing (see costsNothing).
func paidFor(tx *txn.Tx, s *Session) ([]string, error) {
	if s.Cancelled() {
		return nil, nil
	}
	_, line, err := documents.Invoice(tx, s.Source())
	if err != nil {
		return nil, err
	}
	for _, c := range s.Credits {
		if c.Minutes <= 0 || c.Minutes%Step != 0 {
			return []string{fmt.Sprintf("session %s uses %d minutes of package %s", s.ID, c.Minutes, c.PackageID)}, nil
		}
	}
	credited := s.CreditMinutes()
	switch {
	case credited > s.Billable():
		return []string{fmt.Sprintf("session %s is charged %d minutes and credits pay %d", s.ID, s.Billable(), credited)}, nil
	case credited > 0 && line != nil && line.Typed:
		return []string{"session " + s.ID + " uses credits and a fee typed for it"}, nil
	case credited == s.Billable() && line != nil:
		return []string{"session " + s.ID + " is paid for by credits and invoiced"}, nil
	case credited < s.Billable() && line == nil:
		return []string{"session " + s.ID + " is paid for in part, or not at all"}, nil
	}
	return nil, nil
}

// costsNothing is what breaks a cancelled session costing nothing (see
// cancelledWhy).
func costsNothing(tx *txn.Tx, s *Session) ([]string, error) {
	if !s.Cancelled() {
		return nil, nil
	}
	if len(s.Credits) > 0 {
		return []string{"cancelled session " + s.ID + " uses credits"}, nil
	}
	inv, _, err := documents.Invoice(tx, s.Source())
	if err != nil {
		return nil, err
	}
	paid, err := documents.Received(tx, s.Source())
	if err != nil {
		return nil, err
	}
	if inv != nil || paid != nil {
		return []string{"cancelled session " + s.ID + " is on a document"}, nil
	}
	if p, err := packages.BoughtIn(tx, s.ID); err != nil || p != nil {
		return []string{"cancelled session " + s.ID + " buys a package"}, err
	}
	return nil, nil
}

// boughtFollows is what breaks a package bought in a session following it.
func boughtFollows(tx *txn.Tx, p *packages.Package) ([]string, error) {
	s, ok, err := Sessions.Find(tx, p.BoughtIn)
	switch {
	case err != nil:
		return nil, err
	case !ok:
		return []string{fmt.Sprintf("package %s was bought in session %s, which doesn't exist", p.ID, p.BoughtIn)}, nil
	case s.Cancelled():
		return []string{fmt.Sprintf("package %s was bought in session %s, which was cancelled", p.ID, s.ID)}, nil
	case s.ClientID != p.ClientID || !s.Start.Equal(p.PurchasedAt):
		return []string{fmt.Sprintf("package %s isn't its session %s's client's, or day's", p.ID, s.ID)}, nil
	}
	return nil, nil
}

// each checks a rule on a session, if it exists.
func each(rule func(tx *txn.Tx, s *Session) ([]string, error)) func(tx *txn.Tx, id string) ([]string, error) {
	return func(tx *txn.Tx, id string) ([]string, error) {
		s, ok, err := Sessions.Find(tx, id)
		if err != nil || !ok {
			return nil, err
		}
		return rule(tx, s)
	}
}

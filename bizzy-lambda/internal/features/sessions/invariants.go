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
		ID: "fee-or-credit", Why: "A credit pays for a session, or its fee on an invoice: one, never both",
		On: Sessions.Name,
		Broken: each(func(tx *txn.Tx, s *Session) ([]string, error) {
			_, charged, err := documents.Charged(tx, s.Source())
			switch {
			case err != nil:
				return nil, err
			case s.PackageID != "" && charged:
				return []string{"session " + s.ID + " uses a credit and is invoiced"}, nil
			case s.PackageID == "" && !charged:
				return []string{"session " + s.ID + " is paid for by nothing"}, nil
			}
			return nil, nil
		}),
	},
	{
		ID: "credits-of-own-package", Why: "A credit pays for a session from a package of its own client",
		On: Sessions.Name,
		Broken: each(func(tx *txn.Tx, s *Session) ([]string, error) {
			if s.PackageID == "" {
				return nil, nil
			}
			p, ok, err := packages.Packages.Find(tx, s.PackageID)
			switch {
			case err != nil:
				return nil, err
			case !ok:
				return []string{fmt.Sprintf("session %s uses a credit of %s, which doesn't exist", s.ID, s.PackageID)}, nil
			case p.ClientID != s.ClientID:
				return []string{fmt.Sprintf("session %s of %s uses %s's package %s", s.ID, s.ClientID, p.ClientID, p.ID)}, nil
			}
			return nil, nil
		}),
	},
	{
		ID: "credits-in-hand", Why: "No more sessions use a package's credits than it has, and a package used isn't deleted",
		On: packages.Packages.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			used, err := CreditsUsed(tx, id)
			if err != nil {
				return nil, err
			}
			p, ok, err := packages.Packages.Find(tx, id)
			switch {
			case err != nil:
				return nil, err
			case !ok && used > 0:
				return []string{fmt.Sprintf("package %s was deleted while %d sessions use it", id, used)}, nil
			case ok && used > p.Sessions:
				return []string{fmt.Sprintf("package %s has %d credits and %d sessions use them", id, p.Sessions, used)}, nil
			}
			return nil, nil
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
		ID: "session-lines-are-its-clients", Why: "A document's line for a session is on the session's client's document, and an issued invoice's sessions are confirmed",
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
				case s.ClientID != d.ClientID:
					out = append(out, fmt.Sprintf("%s %s for %s covers %s's session %s", d.Type, id, d.ClientID, s.ClientID, s.ID))
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

// boughtFollows is what breaks a package bought in a session following it.
func boughtFollows(tx *txn.Tx, p *packages.Package) ([]string, error) {
	s, ok, err := Sessions.Find(tx, p.BoughtIn)
	switch {
	case err != nil:
		return nil, err
	case !ok:
		return []string{fmt.Sprintf("package %s was bought in session %s, which doesn't exist", p.ID, p.BoughtIn)}, nil
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

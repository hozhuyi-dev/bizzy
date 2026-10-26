package documents

import (
	"fmt"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/platform/txn"
)

// Invariants are what holds for every document, always. That a line
// covers an item that exists, of the document's client, is held by the
// features whose items they are (sessions, packages).
var Invariants = []txn.Invariant{
	{
		ID: "one-live-document-of-each-type", Why: "An item is on at most one live invoice and one live receipt, once, and its Link says which",
		On: Documents.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			d, ok, err := Documents.Find(tx, id)
			if err != nil || !ok || d.Counting() == nil {
				return nil, err
			}
			var out []string
			seen := map[Source]bool{}
			for _, line := range d.Counting().Lines {
				if line.Source == nil {
					continue
				}
				src := *line.Source
				if seen[src] {
					out = append(out, fmt.Sprintf("%s %s covers %s twice", d.Type, id, src.Key()))
				}
				seen[src] = true
				l, ok, err := Links.Find(tx, linkID(src, d.Type))
				if err != nil {
					return nil, err
				}
				if !ok || l.DocumentID != id {
					out = append(out, fmt.Sprintf("%s %s covers %s, whose link doesn't say so", d.Type, id, src.Key()))
				}
			}
			return out, nil
		},
	},
	{
		ID: "documents-cover-something", Why: "A live document is for at least one session or package: none is left on its own",
		On: Documents.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			d, ok, err := Documents.Find(tx, id)
			if err != nil || !ok || d.Counting() == nil || covers(d.Counting().Lines) {
				return nil, err
			}
			return []string{fmt.Sprintf("%s %s covers nothing", d.Type, id)}, nil
		},
	},
	{
		ID: "links-point-at-their-lines", Why: "An item's link is to a live document covering it, and says rightly whether it is owed",
		On: Links.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			l, ok, err := Links.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			d, _, err := covering(tx, l.Source, l.Type)
			if err != nil {
				return nil, err
			}
			if d == nil || d.ID != l.DocumentID || d.Type != l.Type {
				return []string{fmt.Sprintf("link %s points at %s, which doesn't cover it", id, l.DocumentID)}, nil
			}
			if l.Type == TypeInvoice {
				owed, err := owes(tx, l.Source)
				if err != nil {
					return nil, err
				}
				if owed != l.Owed {
					return []string{fmt.Sprintf("link %s says owed %v, but it is %v", id, l.Owed, owed)}, nil
				}
			}
			return nil, nil
		},
	},
	{
		ID: "paid-in-full", Why: "What a receipt says was received for an item is what its invoice charges, and something is charged",
		On: Links.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			l, ok, err := Links.Find(tx, id)
			if err != nil || !ok || l.Type != TypeReceipt {
				return nil, err
			}
			if err := CheckPaid(tx, l.Source); err != nil {
				return []string{fmt.Sprintf("%s: %v", l.Source.Key(), err)}, nil
			}
			return nil, nil
		},
	},
	{
		ID: "paid-in-full", Why: "What a receipt says was received for an item is what its invoice charges, and something is charged",
		On: Documents.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			d, ok, err := Documents.Find(tx, id)
			if err != nil || !ok || d.Counting() == nil {
				return nil, err
			}
			var out []string
			for _, line := range d.Counting().Lines {
				if line.Source == nil {
					continue
				}
				if err := CheckPaid(tx, *line.Source); err != nil {
					out = append(out, fmt.Sprintf("%s: %v", line.Source.Key(), err))
				}
			}
			return out, nil
		},
	},
	{
		ID: "receipt-lines-are-paid", Why: "Every line of a receipt says how and when it was paid; no line of an invoice does",
		On: Documents.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			d, ok, err := Documents.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			var out []string
			for _, c := range []*Content{d.Content, d.Draft} {
				if c == nil {
					continue
				}
				for _, line := range c.Lines {
					if (line.Payment != nil) != (d.Type == TypeReceipt) {
						out = append(out, fmt.Sprintf("%s %s: line %q says paid %v", d.Type, id, line.Description, line.Payment))
					}
				}
			}
			return out, nil
		},
	},
	{
		ID: "documents-are-a-clients", Why: "Every document is for one of the clients, who isn't deleted while it is",
		On: Documents.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			d, ok, err := Documents.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			if _, found, err := clients.Clients.Find(tx, d.ClientID); err != nil || !found {
				return []string{fmt.Sprintf("%s %s is for %q, who isn't a client", d.Type, id, d.ClientID)}, err
			}
			return nil, nil
		},
	},
	{
		ID: "documents-are-a-clients", Why: "Every document is for one of the clients, who isn't deleted while it is",
		On: clients.Clients.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			if _, ok, err := clients.Clients.Find(tx, id); err != nil || ok {
				return nil, err
			}
			if has, err := Documents.HasClient(tx, id); err != nil || has {
				return []string{"client " + id + " was deleted with documents"}, err
			}
			return nil, nil
		},
	},
	{
		ID: "lifecycle", Why: "A draft has no number; an issued or cancelled one has its number, revision and link; a cancelled one isn't being edited",
		On: Documents.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			d, ok, err := Documents.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			bad := func(what string) ([]string, error) { return []string{fmt.Sprintf("%s %s %s", d.Type, id, what)}, nil }
			switch d.Status {
			case StatusDraft:
				if d.Issued() || d.Revision != nil || d.ShareToken != "" || d.Draft == nil {
					return bad("is a draft with a number, a link or no content")
				}
			case StatusIssued, StatusCancelled:
				if !d.Issued() || d.Revision == nil || d.Content == nil || d.ShareToken == "" {
					return bad("was issued without its number, revision, content or link")
				}
				if d.Status == StatusCancelled && d.Draft != nil {
					return bad("is cancelled and being edited")
				}
			}
			if c := d.Counting(); c != nil && !d.Issued() && c.TotalCents != c.Total() {
				return bad("doesn't add up")
			}
			return nil, nil
		},
	},
	{
		ID: "every-issue-is-kept", Why: "Every revision issued is kept as it was, so its PDF can be rebuilt, and its link opens it",
		On: Documents.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			d, ok, err := Documents.Find(tx, id)
			if err != nil || !ok || !d.Issued() || d.Revision == nil {
				return nil, err
			}
			for rev := 0; rev <= *d.Revision; rev++ {
				if _, ok, err := Revisions.Find(tx, revisionID(id, rev)); err != nil || !ok {
					return []string{fmt.Sprintf("%s revision %d isn't kept", d.Number, rev)}, err
				}
			}
			if s, ok, err := Shares.Find(tx, d.ShareToken); err != nil || !ok || s.DocumentID != id {
				return []string{fmt.Sprintf("%s's link opens nothing", d.Number)}, err
			}
			return nil, nil
		},
	},
}

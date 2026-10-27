package packages

import (
	"fmt"
	"slices"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/platform/txn"
)

// Invariants are what holds for every package, always. That sessions use
// no more of one than it has, and that one bought in a session follows
// it, are held by sessions, which see both.
var Invariants = []txn.Invariant{
	{
		ID: "packages-are-invoiced", Why: invoicedWhy,
		On: Packages.Name, Broken: invoiced,
	},
	{
		// A commit that changes only documents is checked from their side.
		ID: "packages-are-invoiced", Why: invoicedWhy,
		On: documents.Links.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			if src, t, ok := documents.LinkSource(id); ok && t == documents.TypeInvoice && src.Kind == documents.SourcePackage {
				return invoiced(tx, src.ID)
			}
			return nil, nil
		},
	},
	{
		ID: "packages-are-a-clients", Why: "Every package is a client's",
		On: Packages.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			p, ok, err := Packages.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			if _, found, err := clients.Clients.Find(tx, p.ClientID); err != nil || !found {
				return []string{fmt.Sprintf("package %s is for %q, who isn't a client", id, p.ClientID)}, err
			}
			return nil, nil
		},
	},
	{
		ID: "shared-with-clients", Why: "A package is shared with other clients, each once",
		On: Packages.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			p, ok, err := Packages.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			var out []string
			for i, other := range p.SharedWith {
				switch {
				case other == p.ClientID:
					out = append(out, fmt.Sprintf("package %s is shared with its own client", id))
				case slices.Index(p.SharedWith, other) != i:
					out = append(out, fmt.Sprintf("package %s is shared with %s twice", id, other))
				default:
					if _, found, err := clients.Clients.Find(tx, other); err != nil {
						return nil, err
					} else if !found {
						out = append(out, fmt.Sprintf("package %s is shared with %q, who isn't a client", id, other))
					}
				}
			}
			return out, nil
		},
	},
	{
		ID: "clients-keep-their-packages", Why: "A client with packages, or packages shared with them, isn't deleted",
		On: clients.Clients.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			if _, ok, err := clients.Clients.Find(tx, id); err != nil || ok {
				return nil, err
			}
			if has, err := Packages.HasClient(tx, id); err != nil || has {
				return []string{"client " + id + " was deleted with packages"}, err
			}
			if has, err := SharedWith(tx, id); err != nil || has {
				return []string{"client " + id + " was deleted with packages shared with them"}, err
			}
			return nil, nil
		},
	},
	{
		ID: "package-lines-are-its-clients", Why: "A document's line for a package is for the package's client, whoever pays",
		On: documents.Documents.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			d, ok, err := documents.Documents.Find(tx, id)
			if err != nil || !ok || d.Counting() == nil {
				return nil, err
			}
			var out []string
			for _, line := range d.Counting().Lines {
				if line.Source == nil || line.Source.Kind != documents.SourcePackage {
					continue
				}
				p, found, err := Packages.Find(tx, line.Source.ID)
				switch {
				case err != nil:
					return nil, err
				case !found:
					out = append(out, fmt.Sprintf("%s %s covers package %s, which doesn't exist", d.Type, id, line.Source.ID))
				case p.ClientID != d.ForClient(line):
					out = append(out, fmt.Sprintf("%s %s's line for %s covers %s's package %s", d.Type, id, d.ForClient(line), p.ClientID, p.ID))
				}
			}
			return out, nil
		},
	},
}

const invoicedWhy = "A package is always on an invoice, which says its price"

// invoiced is what breaks a package being on an invoice.
func invoiced(tx *txn.Tx, id string) ([]string, error) {
	if _, ok, err := Packages.Find(tx, id); err != nil || !ok {
		return nil, err
	}
	if _, charged, err := documents.Charged(tx, documents.PackageSource(id)); err != nil || !charged {
		return []string{"package " + id + " is on no invoice"}, err
	}
	return nil, nil
}

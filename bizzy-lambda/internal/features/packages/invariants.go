package packages

import (
	"fmt"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/platform/txn"
)

// Invariants are what holds for every package, always. That no more
// sessions use one than it has, and that one bought in a session follows
// it, are held by sessions, which see both.
var Invariants = []txn.Invariant{
	{
		ID: "packages-are-invoiced", Why: "A package is always on an invoice, which says its price",
		On: Packages.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			if _, ok, err := Packages.Find(tx, id); err != nil || !ok {
				return nil, err
			}
			if _, charged, err := documents.Charged(tx, documents.PackageSource(id)); err != nil || !charged {
				return []string{"package " + id + " is on no invoice"}, err
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
		ID: "clients-keep-their-packages", Why: "A client with packages isn't deleted",
		On: clients.Clients.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			if _, ok, err := clients.Clients.Find(tx, id); err != nil || ok {
				return nil, err
			}
			if has, err := Packages.HasClient(tx, id); err != nil || has {
				return []string{"client " + id + " was deleted with packages"}, err
			}
			return nil, nil
		},
	},
	{
		ID: "package-lines-are-its-clients", Why: "A document's line for a package is on the package's client's document",
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
				case p.ClientID != d.ClientID:
					out = append(out, fmt.Sprintf("%s %s for %s covers %s's package %s", d.Type, id, d.ClientID, p.ClientID, p.ID))
				}
			}
			return out, nil
		},
	},
}

// Package payments is recording what clients paid, for sessions and
// packages: a draft receipt per payer, each item paid in full (see
// documents). It holds no entity of its own: a payment is its receipt's
// lines.
package payments

import (
	"fmt"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// ItemKind is what is paid for.
type ItemKind string

const (
	ItemSession ItemKind = "session"
	ItemPackage ItemKind = "package"
)

// Item is one thing paid for: a session, which is everything it still
// owes (its fee, and the package bought in it), or a package.
type Item struct {
	Kind ItemKind `json:"kind"`
	ID   string   `json:"id"`
}

// Set records what was paid, in full, for items; with no payment it
// undoes theirs, recorded by mistake.
func Set(tx *txn.Tx, items []Item, in *documents.PaymentInput) error {
	if len(items) == 0 {
		return apperr.Invalid("Choose what was paid.")
	}
	seen := map[documents.Source]bool{}
	var paying []documents.Paying
	for _, it := range items {
		lines, err := check(tx, it, in != nil)
		if err != nil {
			return err
		}
		for _, p := range lines {
			if seen[p.Source] {
				continue // A session's package, listed with it.
			}
			seen[p.Source] = true
			if in == nil {
				if err := documents.Unpay(tx, p.Source); err != nil {
					return err
				}
				continue
			}
			paying = append(paying, p)
		}
	}
	if in == nil {
		return nil
	}
	pay, err := in.Check(tx.Now(), tx.Location())
	if err != nil {
		return err
	}
	return documents.Pay(tx, paying, pay)
}

// check is what paying (or, undoing, unpaying) an item covers, or the
// refusal to.
func check(tx *txn.Tx, it Item, paying bool) ([]documents.Paying, error) {
	switch it.Kind {
	case ItemSession:
		s, err := sessions.Sessions.Get(tx, it.ID)
		if err != nil {
			return nil, err
		}
		if !paying {
			if err := sessions.CanUndoPayment(tx, s); err != nil {
				return nil, err
			}
			return []documents.Paying{{Source: s.Source(), What: sessions.Describe(tx, s)}}, nil
		}
		if err := sessions.CanPay(tx, s); err != nil {
			return nil, err
		}
		var out []documents.Paying
		if owing, err := owes(tx, s.Source()); err != nil {
			return nil, err
		} else if owing {
			out = append(out, documents.Paying{Source: s.Source(), What: sessions.Describe(tx, s)})
		}
		if p, err := packages.BoughtIn(tx, s.ID); err != nil {
			return nil, err
		} else if p != nil {
			if owing, err := owes(tx, documents.PackageSource(p.ID)); err != nil {
				return nil, err
			} else if owing {
				out = append(out, documents.Paying{Source: documents.PackageSource(p.ID), What: describe(tx, p)})
			}
		}
		return out, nil
	case ItemPackage:
		p, err := packages.Packages.Get(tx, it.ID)
		if err != nil {
			return nil, err
		}
		check := packages.CanPay
		if !paying {
			check = packages.CanUndoPayment
		}
		if err := check(tx, p); err != nil {
			return nil, err
		}
		return []documents.Paying{{Source: documents.PackageSource(p.ID), What: describe(tx, p)}}, nil
	}
	return nil, apperr.Invalid("Unknown item kind %q.", it.Kind)
}

// owes reports whether an item is charged something no receipt pays.
func owes(tx *txn.Tx, src documents.Source) (bool, error) {
	cents, _, err := documents.Charged(tx, src)
	if err != nil || cents == 0 {
		return false, err
	}
	paid, err := documents.Received(tx, src)
	return paid == nil, err
}

func describe(tx *txn.Tx, p *packages.Package) string {
	return fmt.Sprintf("the package bought on %s", p.PurchasedAt.In(tx.Location()).Format("2 Jan"))
}

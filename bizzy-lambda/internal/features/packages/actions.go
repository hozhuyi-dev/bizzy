package packages

import (
	"fmt"
	"strings"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// Fields are what the app sets on a package; nil leaves a field as it is.
type Fields struct {
	ClientID    *string    `json:"clientId,omitempty"`
	Hours       *int       `json:"hours,omitempty"`
	PriceCents  *int64     `json:"priceCents,omitempty"`
	PurchasedAt *time.Time `json:"purchasedAt,omitempty"`
	Note        *string    `json:"note,omitempty"`
	// Paid records it paid, when the user was paid there and then.
	Paid *documents.PaymentInput `json:"paid,omitempty"`
	// UpdatePayment moves what was received for it to a new price, on a
	// receipt not issued yet.
	UpdatePayment bool `json:"updatePayment,omitempty"`
}

// Create buys a package on its own.
func Create(tx *txn.Tx, f Fields, used Usage) (*Package, error) {
	if f.ClientID == nil || f.Hours == nil || f.PriceCents == nil || f.PurchasedAt == nil {
		return nil, apperr.Invalid("A package needs a client, how many hours, a price and when it was bought.")
	}
	if _, err := clients.Clients.Get(tx, *f.ClientID); err != nil {
		return nil, err
	}
	p := &Package{ID: tx.NewID(), ClientID: *f.ClientID, CreatedAt: tx.Now().UTC()}
	if err := Packages.Add(tx, p); err != nil {
		return nil, err
	}
	return p, apply(tx, p, f, used, "")
}

// Update changes what f sets. One bought in a session follows it: its
// client and day are the session's to change.
func Update(tx *txn.Tx, id string, f Fields, used Usage) (*Package, error) {
	p, err := Packages.Get(tx, id)
	if err != nil {
		return nil, err
	}
	if f.ClientID != nil && *f.ClientID != p.ClientID || f.PurchasedAt != nil && !f.PurchasedAt.Equal(p.PurchasedAt) {
		if err := CanMoveBought(p); err != nil {
			return nil, err
		}
	}
	return p, apply(tx, p, f, used, "")
}

// CanMoveBought is the refusal for changing the client or day of a
// package: not one bought in a session, which has the session's.
func CanMoveBought(p *Package) error {
	if p.BoughtIn == "" {
		return nil
	}
	return apperr.Refused("It was bought in a session: change that session instead, or keep it as a package on its own.",
		apperr.Remedy{Action: "sessions.update", Target: p.BoughtIn, Label: "Change the session"},
		apperr.Remedy{Action: "packages.makeStandalone", Target: p.ID, Label: "Keep it as a package on its own"})
}

// CanReassign is the refusal for moving a package to another client: no
// session uses its credits, and no issued document covers it.
func CanReassign(tx *txn.Tx, p *Package, used Usage) error {
	if n, err := used(tx, p.ID); err != nil {
		return err
	} else if n > 0 {
		return apperr.Refused(fmt.Sprintf("Sessions use %s of this package's credits, so it stays their client's.", Hours(n)))
	}
	return documents.CanChange(tx, documents.PackageSource(p.ID), documents.TypeInvoice, documents.TypeReceipt)
}

// CanResize is the refusal for changing how many hours a package has: no
// issued invoice is for it.
func CanResize(tx *txn.Tx, p *Package) error {
	if inv, _, err := documents.Invoice(tx, documents.PackageSource(p.ID)); err != nil {
		return err
	} else if inv != nil && inv.Issued() {
		return apperr.Refused(fmt.Sprintf("%s is issued for a package of %s. Cancel it first, then change the package.", inv.Number, Hours(p.Hours*60)),
			apperr.Remedy{Action: "documents.cancel", Target: inv.ID, Label: "Cancel " + inv.Number})
	}
	return nil
}

// CanReprice is the refusal for changing a package's price: no issued
// invoice charges it, and no issued receipt records what was paid for it
// (the payment would no longer match).
func CanReprice(tx *txn.Tx, p *Package) error {
	return documents.CanChange(tx, documents.PackageSource(p.ID), documents.TypeInvoice, documents.TypeReceipt)
}

// Bought is a package bought in a session, as its booking says it.
type Bought struct {
	Hours      int   `json:"hours"`
	PriceCents int64 `json:"priceCents"`
}

// Rebuy makes the package bought in a session what its booking says:
// bought (on the session's invoice draft, into), changed, or no longer
// bought, which deletes it. It follows the session's client and day.
func Rebuy(tx *txn.Tx, sessionID, clientID string, at time.Time, b *Bought, into string, used Usage) (*Package, error) {
	p, err := BoughtIn(tx, sessionID)
	switch {
	case err != nil:
		return nil, err
	case b == nil && p == nil:
		return nil, nil
	case b == nil:
		return nil, Delete(tx, p.ID, used)
	case p == nil:
		p = &Package{ID: tx.NewID(), ClientID: clientID, BoughtIn: sessionID, CreatedAt: tx.Now().UTC()}
		if err := Packages.Add(tx, p); err != nil {
			return nil, err
		}
	}
	f := Fields{ClientID: &clientID, Hours: &b.Hours, PriceCents: &b.PriceCents, PurchasedAt: &at}
	return p, apply(tx, p, f, used, into)
}

// Delete deletes a package, with its lines. Refused while sessions use
// its credits, or a payment is recorded for it.
func Delete(tx *txn.Tx, id string, used Usage) error {
	p, err := Packages.Get(tx, id)
	if err != nil {
		return err
	}
	if n, err := used(tx, p.ID); err != nil {
		return err
	} else if n > 0 {
		return apperr.Refused(fmt.Sprintf("Sessions use %s of this package's credits. Give them a fee instead first.", Hours(n)))
	}
	if err := documents.Remove(tx, documents.PackageSource(p.ID), describe(tx, p)); err != nil {
		return err
	}
	return Packages.Delete(tx, id)
}

// MakeStandalone keeps a package bought in a session as one on its own,
// with its credits, payment and documents: the session no longer buys it.
func MakeStandalone(tx *txn.Tx, id string) (*Package, error) {
	p, err := Packages.Get(tx, id)
	if err != nil {
		return nil, err
	}
	if p.BoughtIn == "" {
		return nil, apperr.Refused("This package was bought on its own already.")
	}
	p.BoughtIn = ""
	return p, nil
}

// apply makes the changes f asks, in order: who, how many, when, then
// what it costs (described by how many, dated when). New lines go on into.
func apply(tx *txn.Tx, p *Package, f Fields, used Usage, into string) error {
	src := documents.PackageSource(p.ID)
	cfg, err := settings.Get(tx)
	if err != nil {
		return err
	}
	_, line, err := documents.Invoice(tx, src)
	if err != nil {
		return err
	}
	isNew := line == nil

	if f.ClientID != nil && *f.ClientID != p.ClientID {
		if _, err := clients.Clients.Get(tx, *f.ClientID); err != nil {
			return err
		}
		if err := CanReassign(tx, p, used); err != nil {
			return err
		}
		if err := documents.MoveToClient(tx, src, *f.ClientID, map[documents.Type]string{}); err != nil {
			return err
		}
		p.ClientID = *f.ClientID
	}
	if f.Hours != nil && *f.Hours != p.Hours {
		if *f.Hours < 1 || *f.Hours > 1000 {
			return apperr.Invalid("A package has 1 to 1000 hours.")
		}
		if n, err := used(tx, p.ID); err != nil {
			return err
		} else if *f.Hours*60 < n {
			return apperr.Refused(fmt.Sprintf("Sessions use %s of its credits already.", Hours(n)))
		}
		if err := CanResize(tx, p); err != nil {
			return err
		}
		if !isNew {
			if err := documents.Redescribe(tx, src, Description(cfg, p.Hours), Description(cfg, *f.Hours)); err != nil {
				return err
			}
		}
		p.Hours = *f.Hours
	}
	if f.PurchasedAt != nil {
		if f.PurchasedAt.IsZero() {
			return apperr.Invalid("Say when it was bought.")
		}
		p.PurchasedAt = f.PurchasedAt.UTC()
		if !isNew {
			if err := documents.Redate(tx, src, day(tx, p.PurchasedAt)); err != nil {
				return err
			}
		}
	}
	if f.PriceCents != nil {
		if *f.PriceCents < 0 {
			return apperr.Invalid("A price can't be negative.")
		}
		if _, err := documents.SetCharge(tx, documents.Charge{
			ClientID: p.ClientID, Source: src, Description: Description(cfg, p.Hours),
			Date: day(tx, p.PurchasedAt), Cents: *f.PriceCents, Into: into,
		}); err != nil {
			return err
		}
	}
	if f.Note != nil {
		p.Note = strings.TrimSpace(*f.Note)
	}
	if f.UpdatePayment {
		if err := documents.Repay(tx, src); err != nil {
			return err
		}
	}
	if f.Paid != nil {
		if paid, err := documents.Received(tx, src); err != nil || paid != nil {
			return err
		}
		pay, err := f.Paid.Check(tx.Now(), tx.Location())
		if err != nil {
			return err
		}
		return documents.Pay(tx, []documents.Paying{{Source: src, ClientID: p.ClientID, What: describe(tx, p)}}, pay)
	}
	return nil
}

func day(tx *txn.Tx, t time.Time) string {
	return t.In(tx.Location()).Format(time.DateOnly)
}

// describe names a package as a message does.
func describe(tx *txn.Tx, p *Package) string {
	return "the package bought on " + p.PurchasedAt.In(tx.Location()).Format("2 Jan")
}

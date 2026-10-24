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
	// Payment sets what was paid for it, after its price: recorded,
	// recorded again (another day or way, or at a new price) or undone.
	Payment *PaymentChoice `json:"payment,omitempty"`
}

// PaymentChoice is what was paid for a package, as entered: its payment,
// in full, or none (Payment nil), undoing one recorded by mistake.
type PaymentChoice struct {
	Payment *documents.PaymentInput `json:"payment,omitempty"`
}

// Create buys a package on its own.
func Create(tx *txn.Tx, f Fields, used Usage) (*Package, error) {
	if f.ClientID == nil || f.Hours == nil || f.PriceCents == nil || f.PurchasedAt == nil {
		return nil, apperr.Invalid("A package needs a client, how many hours, a price and when it was bought.")
	}
	if _, err := clients.Active(tx, *f.ClientID); err != nil {
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

// Delete deletes a package bought by mistake, with its lines.
func Delete(tx *txn.Tx, id string, used Usage) error {
	p, err := Packages.Get(tx, id)
	if err != nil {
		return err
	}
	if err := CanDelete(tx, p, used); err != nil {
		return err
	}
	if err := documents.Remove(tx, documents.PackageSource(p.ID), describe(tx, p)); err != nil {
		return err
	}
	return Packages.Delete(tx, id)
}

// CanDelete is the refusal for deleting a package: no session uses its
// credits, no payment is recorded for it, and no issued invoice charges
// it.
func CanDelete(tx *txn.Tx, p *Package, used Usage) error {
	if n, err := used(tx, p.ID); err != nil {
		return err
	} else if n > 0 {
		return apperr.Refused(fmt.Sprintf("Sessions use %s of this package's credits. Give them a fee instead, or cancel them, first.", Hours(n)))
	}
	return documents.CanRemove(tx, documents.PackageSource(p.ID), describe(tx, p))
}

// MakeStandalone keeps a package bought in a session as one on its own,
// with its credits, payment and documents: the session no longer buys it.
func MakeStandalone(tx *txn.Tx, id string) (*Package, error) {
	p, err := Packages.Get(tx, id)
	if err != nil {
		return nil, err
	}
	if err := CanMakeStandalone(p); err != nil {
		return nil, err
	}
	p.BoughtIn = ""
	return p, nil
}

// CanMakeStandalone is the refusal for keeping a package as one on its
// own: one bought in a session.
func CanMakeStandalone(p *Package) error {
	if p.BoughtIn == "" {
		return apperr.Refused("This package was bought on its own already.")
	}
	return nil
}

// CanPay is the refusal for recording a package paid: something is owed
// on it.
func CanPay(tx *txn.Tx, p *Package) error {
	cents, _, err := documents.Charged(tx, documents.PackageSource(p.ID))
	if err != nil {
		return err
	}
	paid, err := documents.Received(tx, documents.PackageSource(p.ID))
	if err != nil {
		return err
	}
	if cents == 0 || paid != nil {
		return apperr.Refused(fmt.Sprintf("Nothing is owed on %s.", describe(tx, p)))
	}
	return nil
}

// CanUndoPayment is the refusal for undoing a package's payment: one is
// recorded, on a receipt not issued.
func CanUndoPayment(tx *txn.Tx, p *Package) error {
	paid, err := documents.Received(tx, documents.PackageSource(p.ID))
	switch {
	case err != nil:
		return err
	case paid == nil:
		return apperr.Refused("No payment is recorded for it.")
	case paid.Issued:
		return apperr.Refused(fmt.Sprintf("%s records it. Cancel it first.", paid.ReceiptNumber),
			apperr.Remedy{Action: "documents.cancel", Target: paid.ReceiptID, Label: "Cancel " + paid.ReceiptNumber})
	}
	return nil
}

// CanChangePayment is the refusal for recording, changing or undoing a
// package's payment: no issued receipt records it.
func CanChangePayment(tx *txn.Tx, p *Package) error {
	paid, err := documents.Received(tx, documents.PackageSource(p.ID))
	if err != nil || paid == nil || !paid.Issued {
		return err
	}
	return apperr.Refused(fmt.Sprintf("%s records its payment. Cancel it first, then change the payment.", paid.ReceiptNumber),
		apperr.Remedy{Action: "documents.cancel", Target: paid.ReceiptID, Label: "Cancel " + paid.ReceiptNumber})
}

// apply makes the changes f asks, in order: who, how many, when, then
// what it costs (described by how many, dated when), then what was paid
// for it. New lines go on into.
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
		if _, err := clients.Active(tx, *f.ClientID); err != nil {
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
	if f.Payment != nil {
		return setPayment(tx, p, f.Payment.Payment)
	}
	return nil
}

// setPayment records what was paid for a package, in full at its price,
// in place of any payment it had; with none, it undoes its payment.
func setPayment(tx *txn.Tx, p *Package, in *documents.PaymentInput) error {
	if err := CanChangePayment(tx, p); err != nil {
		return err
	}
	src := documents.PackageSource(p.ID)
	if in == nil {
		return documents.Unpay(tx, src)
	}
	pay, err := in.Check(tx.Now(), tx.Location())
	if err != nil {
		return err
	}
	return documents.Pay(tx, []documents.Paying{{Source: src, ClientID: p.ClientID, What: describe(tx, p)}}, pay)
}

func day(tx *txn.Tx, t time.Time) string {
	return t.In(tx.Location()).Format(time.DateOnly)
}

// describe names a package as a message does.
func describe(tx *txn.Tx, p *Package) string {
	return "the package bought on " + p.PurchasedAt.In(tx.Location()).Format("2 Jan")
}

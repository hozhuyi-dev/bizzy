package book

import (
	"strings"
	"time"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/shared/money"
)

// SavePackage buys a package on its own, or changes one.
type SavePackage struct {
	// ID is "" for a new one.
	ID          string    `json:"id"`
	ClientID    string    `json:"clientId"`
	Sessions    int       `json:"sessions"`
	PriceCents  int64     `json:"priceCents"`
	PurchasedAt time.Time `json:"purchasedAt"`
	Note        string    `json:"note"`
	// Paid records it paid, when she was paid there and then.
	Paid *money.Input `json:"paid"`
	// UpdatePayment moves what was received for it to a new price, on a
	// receipt not issued yet.
	UpdatePayment bool `json:"updatePayment"`
	// NewID is the id a new one takes.
	NewID string `json:"-"`
}

func (SavePackage) Action() string { return "packages.save" }

func (c SavePackage) Scope() Scope {
	s := Scope{Clients: []string{c.ClientID}}
	if c.ID != "" {
		s.Packages = []string{c.ID}
	}
	return s
}

func (c SavePackage) Apply(b *Book) error {
	if _, err := b.Client(c.ClientID); err != nil {
		return err
	}
	switch {
	case c.Sessions < 1 || c.Sessions > 1000:
		return apperr.Invalid("sessions must be between 1 and 1000")
	case c.PriceCents < 0:
		return apperr.Invalid("price can't be negative")
	case c.PurchasedAt.IsZero():
		return apperr.Invalid("purchase date is required")
	}

	var p *packages.Package
	if c.ID == "" {
		p = &packages.Package{ID: c.NewID, ClientID: c.ClientID, CreatedAt: b.Now.UTC()}
		if p.ID == "" {
			p.ID = b.NewID()
		}
		b.Packages[p.ID] = p
		p.Sessions, p.PurchasedAt = c.Sessions, c.PurchasedAt.UTC()
		b.addLine(documents.TypeInvoice, p.ClientID, "", b.packageLine(p, c.PriceCents))
	} else {
		var err error
		if p, err = b.Package(c.ID); err != nil {
			return err
		}
		if c.ClientID != p.ClientID {
			b.moveToClient(packageSource(p.ID), c.ClientID, map[documents.Type]string{})
			p.ClientID = c.ClientID
		}
		was := p.Sessions
		p.Sessions, p.PurchasedAt = c.Sessions, c.PurchasedAt.UTC()
		b.resize(p, was)
		b.setAmount(packageSource(p.ID), documents.TypeInvoice, c.PriceCents)
		b.redate(packageSource(p.ID))
		if c.UpdatePayment {
			b.repay(packageSource(p.ID))
		}
	}
	p.Note = strings.TrimSpace(c.Note)

	if c.Paid != nil {
		if _, paid := b.line(packageSource(p.ID), documents.TypeReceipt); !paid {
			return b.pay([]Item{{Kind: ItemPackage, ID: p.ID}}, *c.Paid)
		}
	}
	return nil
}

// DeletePackage deletes a package, with its lines.
type DeletePackage struct {
	ID string `json:"id"`
}

func (DeletePackage) Action() string { return "packages.delete" }

func (c DeletePackage) Scope() Scope { return Scope{Packages: []string{c.ID}} }

func (c DeletePackage) Apply(b *Book) error {
	p, err := b.Package(c.ID)
	if err != nil {
		return err
	}
	b.removeLines(packageSource(p.ID), "")
	delete(b.Packages, p.ID)
	if s, ok := b.Sessions[p.BoughtIn]; ok {
		s.BoughtPackageID = ""
	}
	return nil
}

// MakeStandalone keeps a package bought in a session as one on its own,
// with its credits, payment and documents: the session's title no longer
// buys it.
type MakeStandalone struct {
	ID string `json:"id"`
}

func (MakeStandalone) Action() string { return "packages.makeStandalone" }

func (c MakeStandalone) Scope() Scope { return Scope{Packages: []string{c.ID}} }

func (c MakeStandalone) Apply(b *Book) error {
	p, err := b.Package(c.ID)
	if err != nil {
		return err
	}
	if p.BoughtIn == "" {
		b.problem(Key("package", p.ID), Problem{Kind: Lifecycle, Text: "This package was bought on its own already."})
		return nil
	}
	if s, ok := b.Sessions[p.BoughtIn]; ok {
		s.BoughtPackageID = ""
	}
	p.BoughtIn = ""
	return nil
}

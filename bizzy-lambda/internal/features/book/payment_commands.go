package book

import (
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/shared/money"
)

// ItemKind is what is paid for.
type ItemKind string

const (
	ItemSession ItemKind = "session"
	ItemPackage ItemKind = "package"
)

// Item is one thing paid for: a session's fee, or a package.
type Item struct {
	Kind ItemKind `json:"kind"`
	ID   string   `json:"id"`
}

func (it Item) source() documents.Source {
	if it.Kind == ItemPackage {
		return packageSource(it.ID)
	}
	return sessionSource(it.ID)
}

// SetPayment records what she was paid, in full, for one or more items
// (a session and the package bought in it, often): a draft receipt for
// each client. Nil Payment undoes their payment, recorded by mistake.
type SetPayment struct {
	Items   []Item       `json:"items"`
	Payment *money.Input `json:"payment"`
}

func (SetPayment) Action() string { return "payments.set" }

func (c SetPayment) Scope() Scope {
	var s Scope
	for _, it := range c.Items {
		if it.Kind == ItemPackage {
			s.Packages = append(s.Packages, it.ID)
		} else {
			s.Sessions = append(s.Sessions, it.ID)
		}
	}
	return s
}

func (c SetPayment) Apply(b *Book) error {
	if len(c.Items) == 0 {
		return apperr.Invalid("choose what was paid")
	}
	seen := map[Item]bool{}
	for _, it := range c.Items {
		if seen[it] {
			return apperr.Invalid("each item is paid once")
		}
		seen[it] = true
		if err := b.exists(it); err != nil {
			return err
		}
	}
	if c.Payment == nil {
		for _, it := range c.Items {
			b.removeLines(it.source(), documents.TypeReceipt)
		}
		return nil
	}
	return b.pay(c.Items, *c.Payment)
}

func (b *Book) exists(it Item) error {
	switch it.Kind {
	case ItemSession:
		_, err := b.Session(it.ID)
		return err
	case ItemPackage:
		_, err := b.Package(it.ID)
		return err
	}
	return apperr.Invalid("unknown item kind %q", it.Kind)
}

// pay records items paid in full, on a draft receipt per client, in place
// of any receipt line they had.
func (b *Book) pay(items []Item, in money.Input) error {
	in, err := in.Check(b.Now, b.Location)
	if err != nil {
		return err
	}
	drafts := map[string]*documents.Document{}
	for _, it := range items {
		src := it.source()
		clientID, line := b.receiptLine(src)
		owed := line.AmountCents
		if owed == 0 {
			b.problem(Key(string(it.Kind), it.ID), Problem{Kind: NothingDue, Text: "Nothing is owed on it."})
		}
		b.removeLines(src, documents.TypeReceipt)
		d, ok := drafts[clientID]
		if !ok {
			d = b.newDraft(documents.TypeReceipt, clientID)
			d.Draft.Payment = &documents.Payment{Method: in.Method, PaidOn: in.PaidOn}
			drafts[clientID] = d
		}
		b.addLine(documents.TypeReceipt, clientID, d.ID, line)
	}
	return nil
}

// receiptLine is the line a receipt has for an item: what its invoice
// charges, as it describes it.
func (b *Book) receiptLine(src documents.Source) (clientID string, line documents.Line) {
	amount := b.invoiceAmount(src)
	if src.Kind == documents.SourcePackage {
		p := b.Packages[src.ID]
		return p.ClientID, b.packageLine(p, amount)
	}
	s := b.Sessions[src.ID]
	return s.ClientID, b.sessionLine(s, amount)
}

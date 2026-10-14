package book

import (
	"cmp"
	"slices"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/shared/docref"
	"bizzy-lambda/internal/shared/money"
)

// Derive writes every field an item copies from another, from what is true:
//
//   - a document's sources, total and date, from its lines;
//   - a session's or package's fee and invoice, and what was received and
//     its receipt, from the live documents' lines covering it;
//   - a package's credits used, from the sessions it covers, and what a
//     session still owes for the package bought in it;
//   - whether a session's or follow-up's event is still to be written
//     (Projection, FollowUpProjection);
//   - each loaded client's activity.
//
// It runs before every commit, so the copies never disagree with what they
// copy, and it changes nothing when run twice.
func (b *Book) Derive() {
	for _, id := range SortedIDs(b.Docs) {
		d := b.Docs[id]
		c := content(d)
		if c == nil {
			d.Sources = []documents.Source{}
			continue
		}
		if d.Status == documents.StatusDraft {
			// A draft's lines are dated as what they cover; issued content
			// is never touched.
			for i := range c.Lines {
				if src := c.Lines[i].Source; src != nil {
					if day, ok := b.date(*src); ok {
						c.Lines[i].Date = day
					}
				}
			}
			if c.Payment != nil {
				c.PaidBy = money.MethodLabels[c.Payment.Method]
			}
			c.TotalCents = c.Total()
		}
		d.Sources = sourcesOf(c.Lines)
		d.Date, d.TotalCents = c.Date, c.TotalCents
	}

	for _, s := range b.Sessions {
		s.FeeCents, s.Invoice, s.Receipt, s.Paid, s.BoughtOwedCents = 0, nil, nil, nil, 0
	}
	for _, p := range b.Packages {
		p.PriceCents, p.Invoice, p.Receipt, p.Paid, p.CreditsUsed = 0, nil, nil, nil, 0
	}
	for _, id := range SortedIDs(b.Docs) {
		d := b.Docs[id]
		if !d.Live() {
			continue
		}
		c := content(d)
		ref := d.Ref()
		for _, line := range c.Lines {
			if line.Source == nil {
				continue
			}
			switch it := b.item(*line.Source); {
			case it == nil:
			case d.Type == documents.TypeInvoice:
				*it.fee += line.AmountCents
				*it.invoice = ptr(ref)
			case d.Type == documents.TypeReceipt:
				paid := money.Paid{AmountCents: line.AmountCents}
				if c.Payment != nil {
					paid.Method, paid.PaidOn = c.Payment.Method, c.Payment.PaidOn
				}
				if *it.paid != nil {
					paid.AmountCents += (*it.paid).AmountCents
				}
				*it.paid, *it.receipt = &paid, ptr(ref)
			}
		}
	}
	for _, s := range b.Sessions {
		if p, ok := b.Packages[s.PackageID]; ok {
			p.CreditsUsed++
		}
	}
	for _, s := range b.Sessions {
		if p, ok := b.Packages[s.BoughtPackageID]; ok {
			s.BoughtOwedCents = p.OwedCents()
		}
	}
	for _, id := range SortedIDs(b.Sessions) {
		s := b.Sessions[id]
		want := b.Projection(s)
		s.Event.Pending = s.Event.Seen == nil || !want.Same(*s.Event.Seen)
	}
	for _, id := range SortedIDs(b.FollowUps) {
		f := b.FollowUps[id]
		want := b.FollowUpProjection(f)
		f.Event.Pending = f.Event.Seen == nil || !want.Same(*f.Event.Seen)
	}
	for id := range b.Loaded {
		if c, ok := b.Clients[id]; ok {
			c.Activity, c.LastSessionAt, c.NextBookedAt = b.Activity(id)
			b.Clients[id] = c
		}
	}
}

// itemFields are the fields of a session or package Derive copies money
// into.
type itemFields struct {
	fee              *int64
	invoice, receipt **docref.Ref
	paid             **money.Paid
}

func (b *Book) item(src documents.Source) *itemFields {
	if src.Kind == documents.SourcePackage {
		p, ok := b.Packages[src.ID]
		if !ok {
			return nil
		}
		return &itemFields{fee: &p.PriceCents, invoice: &p.Invoice, receipt: &p.Receipt, paid: &p.Paid}
	}
	s, ok := b.Sessions[src.ID]
	if !ok {
		return nil
	}
	return &itemFields{fee: &s.FeeCents, invoice: &s.Invoice, receipt: &s.Receipt, paid: &s.Paid}
}

func sourcesOf(lines []documents.Line) []documents.Source {
	out := []documents.Source{}
	for _, line := range lines {
		if line.Source != nil && !slices.Contains(out, *line.Source) {
			out = append(out, *line.Source)
		}
	}
	slices.SortFunc(out, func(a, b documents.Source) int {
		return cmp.Or(cmp.Compare(a.Kind, b.Kind), cmp.Compare(a.ID, b.ID))
	})
	return out
}

// Unpriced reports whether nothing pays for a session: no credit, and no
// invoice line charges it.
func (b *Book) Unpriced(s *sessions.Session) bool {
	if s.OnCredit() {
		return false
	}
	_, ok := b.line(sessionSource(s.ID), documents.TypeInvoice)
	return !ok
}

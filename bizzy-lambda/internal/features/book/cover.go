package book

import (
	"fmt"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/sessions"
)

// What pays for a session is chosen once, when it is booked or when what
// pays for it is asked to change (a fee entered or cleared, another client):
// never again behind her back, so a credit or a fee she has seen stays.
//
//  1. a fee entered for the session is its fee;
//  2. otherwise the oldest package of its client with a credit left,
//     bought by the session's start (the package bought in the session
//     itself included: it uses the first credit);
//  3. otherwise the client's usual fee on its day (clients.Client.FeeOn);
//  4. otherwise nothing, which the fee-known guard refuses.

// creditFor is the package whose credit would cover the session: ""
// when none has one left.
func (b *Book) creditFor(s *sessions.Session) string {
	for _, p := range b.ClientPackages(s.ClientID) {
		if p.PurchasedAt.After(s.Start) {
			continue
		}
		if len(b.Using(p.ID)) < p.Sessions {
			return p.ID
		}
	}
	return ""
}

// price sets what pays for a session: fee when one is entered, else a
// credit or the client's usual fee. A fee goes on the session's invoice
// line, or a new one on into (a draft) when it has none.
func (b *Book) price(s *sessions.Session, fee *int64, into string) {
	src := sessionSource(s.ID)
	s.PackageID = ""
	if fee != nil {
		s.FeeTyped = true
		b.charge(s, *fee, into)
		return
	}
	s.FeeTyped = false
	if id := b.creditFor(s); id != "" {
		s.PackageID = id
		b.removeLines(src, documents.TypeInvoice)
		return
	}
	client := b.Clients[s.ClientID]
	if usual := client.FeeOn(b.LocalDate(s.Start)); usual != nil {
		b.charge(s, *usual, into)
		return
	}
	b.removeLines(src, documents.TypeInvoice)
	b.problem(Key("session", s.ID), Problem{
		Kind: NoFee, ClientID: s.ClientID, EventID: s.Event.EventID,
		Text: fmt.Sprintf("Enter the fee: %s has no usual fee, and no package credit covers this session.", client.Name),
	})
}

// charge puts the session's fee on its invoice line, or on a new line.
func (b *Book) charge(s *sessions.Session, cents int64, into string) {
	src := sessionSource(s.ID)
	if _, ok := b.line(src, documents.TypeInvoice); ok {
		b.setAmount(src, documents.TypeInvoice, cents)
		return
	}
	b.addLine(documents.TypeInvoice, s.ClientID, into, b.sessionLine(s, cents))
}

// draftInvoiceOf is the never-issued draft invoice an item's line is on,
// for what is bought with it to join; "" when it has none.
func (b *Book) draftInvoiceOf(src documents.Source) string {
	if l, ok := b.line(src, documents.TypeInvoice); ok && l.doc.Status == documents.StatusDraft {
		return l.doc.ID
	}
	return ""
}

// invoiceAmount is what an item's invoice says it costs.
func (b *Book) invoiceAmount(src documents.Source) int64 {
	var total int64
	for _, l := range b.lines(src, documents.TypeInvoice) {
		total += l.Line().AmountCents
	}
	return total
}

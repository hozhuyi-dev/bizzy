// Package packages tracks prepaid session bundles. A package is bought in a
// session (its title says `10x85`, and it is collected with that session) or
// on its own in the app. Each credit is given to a session when the session
// is booked, and stays with it (see book).
//
// As for sessions, its price is its invoice's line and what was received
// its receipt's; the fields below that say so are copies the book keeps in
// step.
package packages

import (
	"slices"
	"time"

	"bizzy-lambda/internal/shared/docref"
	"bizzy-lambda/internal/shared/money"
)

type Package struct {
	ID          string    `json:"id" dynamodbav:"id"`
	ClientID    string    `json:"clientId" dynamodbav:"clientId"`
	Sessions    int       `json:"sessions" dynamodbav:"sessions"`
	PurchasedAt time.Time `json:"purchasedAt" dynamodbav:"purchasedAt"`
	// BoughtIn is the session it was bought in, whose title shows it; ""
	// for one bought on its own.
	BoughtIn string `json:"boughtIn,omitempty" dynamodbav:"boughtIn,omitempty"`
	Note     string `json:"note,omitempty" dynamodbav:"note,omitempty"`

	// Copied by the book on every write.
	// CreditsUsed is how many sessions its credits cover.
	CreditsUsed int `json:"creditsUsed" dynamodbav:"creditsUsed"`
	// PriceCents is what its invoice line charges.
	PriceCents int64       `json:"priceCents" dynamodbav:"priceCents"`
	Invoice    *docref.Ref `json:"invoice,omitempty" dynamodbav:"invoice,omitempty"`
	Receipt    *docref.Ref `json:"receipt,omitempty" dynamodbav:"receipt,omitempty"`
	Paid       *money.Paid `json:"paid,omitempty" dynamodbav:"paid,omitempty"`

	CreatedAt time.Time `json:"createdAt" dynamodbav:"createdAt"`
	Version   int       `json:"version" dynamodbav:"version"`
}

// Ref returns the document in a slot.
func (p Package) Ref(slot docref.Slot) *docref.Ref {
	if slot == docref.SlotInvoice {
		return p.Invoice
	}
	return p.Receipt
}

func (p Package) CreditsLeft() int {
	return max(p.Sessions-p.CreditsUsed, 0)
}

// OwedCents is its price while not received.
func (p Package) OwedCents() int64 {
	if p.Paid != nil {
		return 0
	}
	return p.PriceCents
}

// Open reports whether the package is still in use, or still to be paid:
// the open index is where the to-do list and the packages page read from.
func (p Package) Open() bool {
	return p.CreditsLeft() > 0 || p.OwedCents() > 0
}

// CollectOnItsOwn reports whether it goes on her to-do list as itself: one
// bought in a session is collected with that session instead.
func (p Package) CollectOnItsOwn(now time.Time) bool {
	return slices.Contains(p.Todo(now), ReasonCollect)
}

// ShareCents is the value of credit i (0-based): the price split evenly, with
// the leftover cents on the first credits so the shares add up exactly.
func (p Package) ShareCents(i int) int64 {
	if p.Sessions < 1 {
		return 0
	}
	n := int64(p.Sessions)
	share := p.PriceCents / n
	if int64(i) < p.PriceCents%n {
		share++
	}
	return share
}

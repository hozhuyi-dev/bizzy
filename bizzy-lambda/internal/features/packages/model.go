// Package packages tracks prepaid session bundles. Credits are applied in
// date order to the client's unpriced sessions from the purchase onward by
// the billing reconcile, which also records how many are used.
package packages

import (
	"slices"
	"time"

	"bizzy-lambda/internal/shared/docref"
	"bizzy-lambda/internal/shared/money"
)

type Source string

const (
	// SourceCalendar packages come from a `10x85` / `10@850` title. Their ID
	// is the event ID, so the sync always maps an event to the same package.
	// Once the title no longer buys it (the event was deleted, or its title
	// changed), the reconcile marks it Unlinked: still a calendar package,
	// kept with its credits, payment and documents, and on the to-do list
	// until the user deletes it or makes it standalone (an app package).
	// Should a title buy it again meanwhile, it is linked back; once
	// standalone, it stays so.
	SourceCalendar Source = "calendar"
	SourceApp      Source = "app"
)

type Package struct {
	ID          string    `json:"id" dynamodbav:"id"`
	ClientID    string    `json:"clientId" dynamodbav:"clientId"`
	Sessions    int       `json:"sessions" dynamodbav:"sessions"`
	PriceCents  int64     `json:"priceCents" dynamodbav:"priceCents"`
	PurchasedAt time.Time `json:"purchasedAt" dynamodbav:"purchasedAt"`
	Source      Source    `json:"source" dynamodbav:"source"`
	Note        string    `json:"note,omitempty" dynamodbav:"note,omitempty"`

	// Derived by the billing reconcile.
	// Unlinked says no calendar title buys this calendar package any more.
	Unlinked    bool `json:"unlinked,omitempty" dynamodbav:"unlinked,omitempty"`
	CreditsUsed int  `json:"creditsUsed" dynamodbav:"creditsUsed"`
	// Drift explains how the calendar now disagrees with an issued document
	// covering it: its event names another client, or moved.
	Drift string `json:"drift,omitempty" dynamodbav:"drift,omitempty"`

	// Payment settles its price, in full. Written by the payments feature
	// only (see PaymentPatch).
	Payment *money.Payment `json:"payment,omitempty" dynamodbav:"payment,omitempty"`

	// The documents covering it, written by the documents feature.
	Invoice *docref.Ref `json:"invoice,omitempty" dynamodbav:"invoice,omitempty"`
	Receipt *docref.Ref `json:"receipt,omitempty" dynamodbav:"receipt,omitempty"`
}

// Ref returns the document in a slot.
func (p Package) Ref(slot docref.Slot) *docref.Ref {
	if slot == docref.SlotInvoice {
		return p.Invoice
	}
	return p.Receipt
}

// HasDocuments reports whether any document (draft or issued) covers it.
func (p Package) HasDocuments() bool {
	return p.Invoice != nil || p.Receipt != nil
}

func (p Package) CreditsLeft() int {
	return max(p.Sessions-p.CreditsUsed, 0)
}

// Settled reports whether its price needs nothing more: paid, waived, or
// free.
func (p Package) Settled() bool {
	return p.Payment != nil || p.PriceCents == 0
}

// Open reports whether the package is still in use, still to be paid, or
// contradicts a document: the open index is where the to-do list reads
// packages from.
func (p Package) Open() bool {
	return p.CreditsLeft() > 0 || !p.Settled() || len(Rules.Reasons(p.State(p.PurchasedAt))) > 0
}

// CollectOnItsOwn reports whether it goes on her to-do list as itself: a
// calendar package is collected with the session that bought it instead.
func (p Package) CollectOnItsOwn() bool {
	return slices.Contains(p.Todo(p.PurchasedAt), ReasonCollect)
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

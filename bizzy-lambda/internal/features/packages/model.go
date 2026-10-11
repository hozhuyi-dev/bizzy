// Package packages tracks prepaid session bundles. Credits are applied in
// date order to the client's unpriced sessions from the purchase onward by
// the billing reconcile, which also records how many are used.
package packages

import (
	"time"

	"bizzy-lambda/internal/features/docref"
)

type Source string

const (
	// SourceCalendar packages come from a `10x85` / `10@850` title. Their ID
	// is the event ID, so the sync always maps an event to the same package.
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
	CreditsUsed int `json:"creditsUsed" dynamodbav:"creditsUsed"`
	// Removed is set when the calendar entry that bought it no longer does,
	// but a receipt keeps it.
	Removed bool   `json:"removed,omitempty" dynamodbav:"removed,omitempty"`
	Drift   string `json:"drift,omitempty" dynamodbav:"drift,omitempty"`

	// Hers.
	Document *docref.Ref `json:"document,omitempty" dynamodbav:"document,omitempty"`
}

func (p Package) CreditsLeft() int {
	return max(p.Sessions-p.CreditsUsed, 0)
}

// Open reports whether the package still has credits or needs attention.
func (p Package) Open() bool {
	return (!p.Removed && p.CreditsLeft() > 0) || p.Drift != ""
}

// Billable reports whether a receipt can be issued for the package.
func (p Package) Billable() bool {
	return !p.Removed && p.Document == nil
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

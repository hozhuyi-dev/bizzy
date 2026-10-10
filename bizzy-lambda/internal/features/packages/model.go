// Package packages tracks prepaid session bundles. Credits are applied in
// date order to the client's unpriced sessions from the purchase onward, and
// recomputed on every sync, so remaining credit is derived, never stored.
package packages

import "time"

// Package is created either in the app or from an `NxPRICE` calendar token.
//
// DynamoDB: PK = "PACKAGE", SK = "<id>".
type Package struct {
	ID          string    `json:"id" dynamodbav:"id"`
	ClientID    string    `json:"clientId" dynamodbav:"clientId"`
	Sessions    int       `json:"sessions" dynamodbav:"sessions"`
	PriceCents  int64     `json:"priceCents" dynamodbav:"priceCents"`
	PurchasedAt time.Time `json:"purchasedAt" dynamodbav:"purchasedAt"`
	// SourceEventID is set for packages created from the calendar, making the
	// sync idempotent: the same event always maps to the same package.
	SourceEventID string `json:"sourceEventId,omitempty" dynamodbav:"sourceEventId,omitempty"`
	InvoiceID     string `json:"invoiceId,omitempty" dynamodbav:"invoiceId,omitempty"`
}

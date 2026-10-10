// Package invoices issues one invoice per paid session or per package. The
// PDF itself is rendered in the browser; this package only records it.
package invoices

import "time"

// Invoice is immutable once issued.
//
// DynamoDB: PK = "INVOICE", SK = zero-padded Number. Numbers come from an
// atomically incremented PK = "COUNTER", SK = "INVOICE" item, so they are
// gap-free for her records.
type Invoice struct {
	ID         string    `json:"id" dynamodbav:"id"`
	Number     int       `json:"number" dynamodbav:"number"`
	ClientID   string    `json:"clientId" dynamodbav:"clientId"`
	IssuedAt   time.Time `json:"issuedAt" dynamodbav:"issuedAt"`
	TotalCents int64     `json:"totalCents" dynamodbav:"totalCents"`
	// Exactly one of SessionEventID and PackageID is set.
	SessionEventID string `json:"sessionEventId,omitempty" dynamodbav:"sessionEventId,omitempty"`
	PackageID      string `json:"packageId,omitempty" dynamodbav:"packageId,omitempty"`
	Description    string `json:"description" dynamodbav:"description"`
}

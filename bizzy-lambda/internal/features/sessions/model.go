// Package sessions holds sessions imported from the calendar. The calendar is
// the source of truth: sessions are only ever written by the sync, and only
// invoiced sessions are frozen against later calendar edits.
package sessions

import "time"

type Status string

const (
	StatusTentative  Status = "tentative"   // title starts with `?`
	StatusUnbilled   Status = "unbilled"    // ready to invoice
	StatusPackage    Status = "package"     // covered by a package credit
	StatusInvoiced   Status = "invoiced"    // frozen
	StatusUnmatched  Status = "unmatched"   // no client matched the name
	StatusParseError Status = "parse_error" // malformed title
	StatusIgnored    Status = "ignored"     // she dismissed it
)

// Session is keyed by the Google event instance ID.
//
// DynamoDB: PK = "SESSION", SK = "<start RFC3339>#<eventID>".
type Session struct {
	EventID   string    `json:"eventId" dynamodbav:"eventId"`
	Title     string    `json:"title" dynamodbav:"title"`
	Start     time.Time `json:"start" dynamodbav:"start"`
	End       time.Time `json:"end" dynamodbav:"end"`
	Status    Status    `json:"status" dynamodbav:"status"`
	ClientID  string    `json:"clientId,omitempty" dynamodbav:"clientId,omitempty"`
	FeeCents  *int64    `json:"feeCents,omitempty" dynamodbav:"feeCents,omitempty"`
	PackageID string    `json:"packageId,omitempty" dynamodbav:"packageId,omitempty"`
	InvoiceID string    `json:"invoiceId,omitempty" dynamodbav:"invoiceId,omitempty"`
	// Reason explains StatusUnmatched / StatusParseError to her.
	Reason string `json:"reason,omitempty" dynamodbav:"reason,omitempty"`
	// Drifted is set when the calendar event changed after invoicing.
	Drifted bool `json:"drifted,omitempty" dynamodbav:"drifted,omitempty"`
}

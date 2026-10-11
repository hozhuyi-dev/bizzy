// Package sessions holds sessions imported from the calendar. The calendar is
// the source of truth: the sync writes what the event says, the billing
// reconcile derives everything else, and she only ever ignores a session or
// issues a receipt for it.
package sessions

import (
	"time"

	"bizzy-lambda/internal/features/docref"
)

type Status string

const (
	StatusTentative  Status = "tentative"   // title starts with `?`
	StatusParseError Status = "parse_error" // malformed title
	StatusUnmatched  Status = "unmatched"   // no client matched the name
	StatusMissingFee Status = "missing_fee" // no amount, credit or default fee
	StatusPriced     Status = "priced"      // fee known; nothing to do
	StatusPackage    Status = "package"     // covered by a package credit
	StatusIgnored    Status = "ignored"     // she dismissed it
	// StatusRemoved is a session gone from the calendar that is kept only
	// because a receipt covers it.
	StatusRemoved Status = "removed"
)

// Delivered reports whether the session happened and counts toward the
// client's activity.
func (s Status) Delivered() bool {
	return s == StatusPriced || s == StatusPackage || s == StatusMissingFee
}

// NeedsAction reports whether she has something to fix.
func (s Status) NeedsAction() bool {
	return s == StatusTentative || s == StatusParseError || s == StatusUnmatched || s == StatusMissingFee
}

type FeeSource string

const (
	FeeFromTitle   FeeSource = "title"
	FeeFromDefault FeeSource = "default"
	FeeFromPackage FeeSource = "package"
)

type Location string

const (
	LocationClinic Location = "clinic"
	LocationHome   Location = "home"
)

// Session is keyed by the Google event instance ID, so a moved event is the
// same item.
type Session struct {
	EventID string `json:"eventId" dynamodbav:"eventId"`

	// From the calendar (sync).
	Title   string    `json:"title" dynamodbav:"title"`
	Start   time.Time `json:"start" dynamodbav:"start"`
	End     time.Time `json:"end" dynamodbav:"end"`
	ColorID string    `json:"colorId,omitempty" dynamodbav:"colorId,omitempty"`
	// Removed is set when the event left the calendar but a receipt keeps the
	// session; cancelling the receipt lets it go.
	Removed bool `json:"removed,omitempty" dynamodbav:"removed,omitempty"`

	// Derived by the billing reconcile.
	Status            Status    `json:"status" dynamodbav:"status"`
	Name              string    `json:"name,omitempty" dynamodbav:"name,omitempty"`
	ClientID          string    `json:"clientId,omitempty" dynamodbav:"clientId,omitempty"`
	SuggestedClientID string    `json:"suggestedClientId,omitempty" dynamodbav:"suggestedClientId,omitempty"`
	FeeCents          *int64    `json:"feeCents,omitempty" dynamodbav:"feeCents,omitempty"`
	FeeSource         FeeSource `json:"feeSource,omitempty" dynamodbav:"feeSource,omitempty"`
	PackageID         string    `json:"packageId,omitempty" dynamodbav:"packageId,omitempty"`
	// ValueCents is what the session earned: its fee, or its share of the
	// package that covered it.
	ValueCents     int64    `json:"valueCents,omitempty" dynamodbav:"valueCents,omitempty"`
	Location       Location `json:"location,omitempty" dynamodbav:"location,omitempty"`
	LocationSource string   `json:"locationSource,omitempty" dynamodbav:"locationSource,omitempty"`
	// Reason explains StatusUnmatched / StatusParseError / StatusMissingFee.
	Reason string `json:"reason,omitempty" dynamodbav:"reason,omitempty"`
	// Drift explains how the calendar now disagrees with an issued receipt.
	Drift string `json:"drift,omitempty" dynamodbav:"drift,omitempty"`

	// Hers.
	Ignored  bool        `json:"ignored,omitempty" dynamodbav:"ignored,omitempty"`
	Document *docref.Ref `json:"document,omitempty" dynamodbav:"document,omitempty"`
}

// Open reports whether the session belongs on her to-do list.
func (s Session) Open() bool {
	return s.Status.NeedsAction() || s.Drift != ""
}

// Billable reports whether a receipt can be issued for the session.
func (s Session) Billable() bool {
	return s.Status == StatusPriced && s.FeeCents != nil && s.Document == nil
}

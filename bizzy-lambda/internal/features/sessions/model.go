// Package sessions holds sessions imported from the calendar, and what she
// records about each one afterwards. The calendar is the source of truth for
// when and with whom: the sync writes what the event says and the billing
// reconcile derives the rest. Her edits to the booking go to the calendar
// first (see googlesync.Editor); the notes, payment and documents are hers
// and live only here.
//
// A session moves through stages, each derived from facts rather than kept
// as a state:
//
//	unconfirmed (`?` title) → booked → happened → recorded (summary) → paid
//
// with an invoice and a receipt as optional side steps. Payment may come
// before the notes; what is still missing puts it on her to-do list (Todo).
package sessions

import (
	"time"

	"bizzy-lambda/internal/shared/docref"
	"bizzy-lambda/internal/shared/money"
)

type Status string

const (
	StatusTentative  Status = "tentative"   // title starts with `?`
	StatusParseError Status = "parse_error" // malformed title
	StatusUnmatched  Status = "unmatched"   // no client matched the name
	StatusMissingFee Status = "missing_fee" // no amount, credit or default fee
	StatusPriced     Status = "priced"      // fee known
	StatusPackage    Status = "package"     // covered by a package credit
	// StatusRemoved is a session gone from the calendar that is kept for
	// what she recorded on it (see Session.HasHerData).
	StatusRemoved Status = "removed"
)

// Delivered reports whether a session with this status counts toward the
// client's activity once it has happened.
func (s Status) Delivered() bool {
	return s == StatusPriced || s == StatusPackage || s == StatusMissingFee
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

// Record is what she writes about a session after it: a one-line summary
// for lists and the client's timeline. The long notes are a separate item
// (Notes), so lists never pay to read them.
type Record struct {
	Summary string `json:"summary" dynamodbav:"summary"`
	// HasNotes says the Notes item has text.
	HasNotes  bool      `json:"hasNotes,omitempty" dynamodbav:"hasNotes,omitempty"`
	UpdatedAt time.Time `json:"updatedAt" dynamodbav:"updatedAt"`
}

// Session is keyed by the Google event instance ID, so a moved event is the
// same item. It is written whole with a version check (see Repository.Save).
type Session struct {
	EventID string `json:"eventId" dynamodbav:"eventId"`

	// From the calendar (sync).
	Title   string    `json:"title" dynamodbav:"title"`
	Start   time.Time `json:"start" dynamodbav:"start"`
	End     time.Time `json:"end" dynamodbav:"end"`
	ColorID string    `json:"colorId,omitempty" dynamodbav:"colorId,omitempty"`
	// RemovedAt is set when the event left the calendar but the session is
	// kept for her data on it. Restoring the event clears it.
	RemovedAt *time.Time `json:"removedAt,omitempty" dynamodbav:"removedAt,omitempty"`

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
	ValueCents int64 `json:"valueCents,omitempty" dynamodbav:"valueCents,omitempty"`
	// BoughtCents is the price of the package bought in this session (its
	// title says `10x85`). The package is paid on its own (see
	// packages.Package.Payment), but she collects it with the session, so
	// BoughtSettled mirrors whether it is.
	BoughtCents   int64 `json:"boughtCents,omitempty" dynamodbav:"boughtCents,omitempty"`
	BoughtSettled bool  `json:"boughtSettled,omitempty" dynamodbav:"boughtSettled,omitempty"`
	// BoughtDocumented mirrors whether a document covers that package,
	// which locks the booking as the session's own documents do.
	BoughtDocumented bool     `json:"boughtDocumented,omitempty" dynamodbav:"boughtDocumented,omitempty"`
	Location         Location `json:"location,omitempty" dynamodbav:"location,omitempty"`
	LocationSource   string   `json:"locationSource,omitempty" dynamodbav:"locationSource,omitempty"`
	// Reason explains StatusUnmatched / StatusParseError / StatusMissingFee,
	// or a tentative one under a name no client has.
	Reason string `json:"reason,omitempty" dynamodbav:"reason,omitempty"`
	// Drift explains how the calendar now disagrees with an issued document.
	Drift string `json:"drift,omitempty" dynamodbav:"drift,omitempty"`
	// Upcoming is set while it was still ahead at the last reconcile; the
	// sync reconciles it again once it has happened. Never set on a removed
	// session, which the sync no longer reads.
	Upcoming bool `json:"upcoming,omitempty" dynamodbav:"upcoming,omitempty"`
	// ConfirmedAt is when it stopped being tentative; for one never
	// tentative, when it was first seen (at the latest its start).
	ConfirmedAt *time.Time `json:"confirmedAt,omitempty" dynamodbav:"confirmedAt,omitempty"`

	// Hers.
	Record *Record `json:"record,omitempty" dynamodbav:"record,omitempty"`
	// Payment settles the session's own fee; the package bought in it is
	// paid on the package.
	Payment *money.Payment `json:"payment,omitempty" dynamodbav:"payment,omitempty"`

	// The documents covering it, written by the documents feature.
	Invoice *docref.Ref `json:"invoice,omitempty" dynamodbav:"invoice,omitempty"`
	Receipt *docref.Ref `json:"receipt,omitempty" dynamodbav:"receipt,omitempty"`

	Version int `json:"version" dynamodbav:"version"`
}

// Notes are a session's long notes, kept as their own item.
type Notes struct {
	EventID   string    `json:"eventId" dynamodbav:"eventId"`
	Text      string    `json:"text" dynamodbav:"text"`
	UpdatedAt time.Time `json:"updatedAt" dynamodbav:"updatedAt"`
}

// Ref returns the document in a slot.
func (s Session) Ref(slot docref.Slot) *docref.Ref {
	if slot == docref.SlotInvoice {
		return s.Invoice
	}
	return s.Receipt
}

// HasDocuments reports whether any document (draft or issued) covers it.
func (s Session) HasDocuments() bool {
	return s.Invoice != nil || s.Receipt != nil
}

// HasHerData reports whether she recorded anything on the session, which
// keeps it (soft-deleted) when its event leaves the calendar.
func (s Session) HasHerData() bool {
	return s.Record != nil || s.Payment != nil || s.HasDocuments()
}

// Recorded reports whether she has written its summary.
func (s Session) Recorded() bool {
	return s.Record != nil && s.Record.Summary != ""
}

// DueCents is the session's own fee, when one applies: a package credit
// costs nothing more. The package bought in it is due on the package.
func (s Session) DueCents() int64 {
	if s.Status == StatusPriced && s.FeeCents != nil {
		return *s.FeeCents
	}
	return 0
}

// FeeSettled reports whether the session's own fee needs nothing more:
// paid, waived, or nothing due.
func (s Session) FeeSettled() bool {
	return !feeOwed(s.State(s.End))
}

// BoughtDue reports whether the package bought in the session is still to
// be paid.
func (s Session) BoughtDue() bool {
	return boughtOwed(s.State(s.End))
}

// Paid reports whether nothing more is owed on it: its fee and the package
// bought in it.
func (s Session) Paid() bool {
	return !owes(s.State(s.End))
}

// Todo is what is left to do on the session as of now, from its rule table
// (rules.go); nil when nothing.
func (s Session) Todo(now time.Time) []Reason {
	return Rules.Reasons(s.State(now))
}

// Open reports whether the session belongs in the to-do index: whether it
// has something to do once it has happened. A future session is in it while
// unrecorded, and Todo leaves it out until it has happened; the index is
// read only up to a few days ahead.
func (s Session) Open() bool {
	st := s.State(s.End)
	return len(Rules.Reasons(st)) > 0
}

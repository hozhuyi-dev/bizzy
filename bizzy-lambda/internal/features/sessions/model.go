// Package sessions holds her sessions with clients. A session is what bizzy
// says it is: its booking (who, when, where, whether confirmed), what pays
// for it (a package credit, or a fee charged on an invoice), and what she
// records about it afterwards. Google Calendar shows each session as an
// event, and edits made there are read as changes she asks for, applied
// only when they are allowed (see googlesync and book).
//
// A session moves through stages, each derived from facts rather than kept
// as a state:
//
//	unconfirmed (`?` title) → booked → happened → recorded (summary) → paid
//
// Its money is never stored here as a fact of its own: its fee is its
// invoice's line, and what was received its receipt's (see documents). The
// fields below that say so are copies the book keeps in step on every write.
package sessions

import (
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/shared/docref"
	"bizzy-lambda/internal/shared/money"
)

// Location is where a session is: her own place, or a home visit at the
// client's (see calendar.Places for how a title marks it).
type Location string

const (
	LocationOwn   Location = "own"
	LocationVisit Location = "visit"
)

// Record is what she keeps about a session after it: a one-line summary
// for lists and the client's timeline, long notes and attached files. The
// notes are a separate item (Notes) and the files are attachments, so
// lists never pay to read them.
type Record struct {
	Summary string `json:"summary" dynamodbav:"summary"`
	// HasNotes says the Notes item has text.
	HasNotes bool `json:"hasNotes,omitempty" dynamodbav:"hasNotes,omitempty"`
	// Files is how many files are attached (attachments.OwnerSession).
	Files     int       `json:"files,omitempty" dynamodbav:"files,omitempty"`
	UpdatedAt time.Time `json:"updatedAt" dynamodbav:"updatedAt"`
}

// setRecord sets what she keeps about the session, and drops the record
// once nothing is left on it.
func (s *Session) setRecord(summary string, hasNotes bool, files int, now time.Time) {
	if summary == "" && !hasNotes && files == 0 {
		s.Record = nil
		return
	}
	s.Record = &Record{Summary: summary, HasNotes: hasNotes, Files: files, UpdatedAt: now}
}

// Session is written whole with a version check (see Repository.Save).
type Session struct {
	ID       string `json:"id" dynamodbav:"id"`
	ClientID string `json:"clientId" dynamodbav:"clientId"`

	// The booking.
	Start     time.Time `json:"start" dynamodbav:"start"`
	End       time.Time `json:"end" dynamodbav:"end"`
	Tentative bool      `json:"tentative,omitempty" dynamodbav:"tentative,omitempty"`
	// ConfirmedAt is when it stopped being tentative, or was booked
	// confirmed.
	ConfirmedAt *time.Time `json:"confirmedAt,omitempty" dynamodbav:"confirmedAt,omitempty"`
	Location    Location   `json:"location" dynamodbav:"location"`

	// What pays for it: a credit of PackageID, chosen when it was booked;
	// otherwise its fee, charged on an invoice.
	PackageID string `json:"packageId,omitempty" dynamodbav:"packageId,omitempty"`
	// FeeTyped says the fee was entered for this session (its title shows
	// it), rather than taken from the client's usual fee.
	FeeTyped bool `json:"feeTyped,omitempty" dynamodbav:"feeTyped,omitempty"`
	// BoughtPackageID is the package bought in this session (its title
	// shows `10x85`), collected with it.
	BoughtPackageID string `json:"boughtPackageId,omitempty" dynamodbav:"boughtPackageId,omitempty"`

	// Copied from its documents by the book on every write.
	// FeeCents is what its invoice line charges; 0 on a credit.
	FeeCents int64 `json:"feeCents" dynamodbav:"feeCents"`
	// Invoice is the invoice charging it (draft or issued); nil on a credit.
	Invoice *docref.Ref `json:"invoice,omitempty" dynamodbav:"invoice,omitempty"`
	// Receipt is the receipt recording its payment, and Paid what it says.
	Receipt *docref.Ref `json:"receipt,omitempty" dynamodbav:"receipt,omitempty"`
	Paid    *money.Paid `json:"paid,omitempty" dynamodbav:"paid,omitempty"`
	// BoughtOwedCents is what is still owed for the package bought in it.
	BoughtOwedCents int64 `json:"boughtOwedCents,omitempty" dynamodbav:"boughtOwedCents,omitempty"`

	// Hers.
	Record *Record `json:"record,omitempty" dynamodbav:"record,omitempty"`

	// Event is the calendar event showing it.
	Event calendar.Link `json:"event" dynamodbav:"event"`

	CreatedAt time.Time `json:"createdAt" dynamodbav:"createdAt"`
	Version   int       `json:"version" dynamodbav:"version"`
}

// Notes are a session's long notes, kept as their own item.
type Notes struct {
	SessionID string    `json:"sessionId" dynamodbav:"sessionId"`
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

// OnCredit reports whether a package credit covers it.
func (s Session) OnCredit() bool {
	return s.PackageID != ""
}

// OwedCents is its own fee while not received.
func (s Session) OwedCents() int64 {
	if s.Paid != nil {
		return 0
	}
	return s.FeeCents
}

// Recorded reports whether she has written its summary.
func (s Session) Recorded() bool {
	return s.Record != nil && s.Record.Summary != ""
}

// HasRecord reports whether she wrote or attached anything on it.
func (s Session) HasRecord() bool {
	return s.Record != nil
}

// Settled reports whether nothing more is owed on it: its fee and the
// package bought in it.
func (s Session) Settled() bool {
	return s.OwedCents() == 0 && s.BoughtOwedCents == 0
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
	return len(Rules.Reasons(s.State(s.End))) > 0
}

// Files is how many files are attached to it.
func (s Session) Files() int {
	if s.Record == nil {
		return 0
	}
	return s.Record.Files
}

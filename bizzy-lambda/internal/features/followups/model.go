// Package followups holds her reminders to get back to a client. Each is
// shown in the sessions calendar as an event titled `! Name: summary` (see
// calendar.ParseFollowUp), with its notes as the event's description, so
// she can add or change one there too; like a session, it is true in
// bizzy, and changes only through the book (see internal/features/book),
// which reads a calendar edit as the same command the app sends. Marking
// one done is hers and lives only here.
package followups

import (
	"time"

	"bizzy-lambda/internal/features/calendar"
)

// FollowUp is a reminder to get back to a client.
type FollowUp struct {
	ID       string `json:"id" dynamodbav:"id"`
	ClientID string `json:"clientId" dynamodbav:"clientId"`
	// SessionID is the session it was made from, if any.
	SessionID string `json:"sessionId,omitempty" dynamodbav:"sessionId,omitempty"`

	// Due is when it is due: a time, or for an all-day one the start of
	// its day in her time zone.
	Due    time.Time `json:"due" dynamodbav:"due"`
	AllDay bool      `json:"allDay,omitempty" dynamodbav:"allDay,omitempty"`
	// Minutes is how long its event blocks in the calendar; 0 when all-day.
	Minutes int    `json:"minutes,omitempty" dynamodbav:"minutes,omitempty"`
	Summary string `json:"summary,omitempty" dynamodbav:"summary,omitempty"`
	Notes   string `json:"notes,omitempty" dynamodbav:"notes,omitempty"`

	DoneAt *time.Time `json:"doneAt,omitempty" dynamodbav:"doneAt,omitempty"`

	// Event is its event in the calendar.
	Event     calendar.Link `json:"event" dynamodbav:"event"`
	CreatedAt time.Time     `json:"createdAt" dynamodbav:"createdAt"`
	Version   int           `json:"version" dynamodbav:"version"`
}

// DefaultMinutes is how long a timed follow-up made in the app blocks in
// the calendar.
const DefaultMinutes = 15

// End is when its event ends, for a timed one.
func (f FollowUp) End() time.Time {
	return f.Due.Add(time.Duration(f.Minutes) * time.Minute)
}

// Date is the day it is due, in her time zone.
func (f FollowUp) Date(loc *time.Location) string {
	return f.Due.In(loc).Format(time.DateOnly)
}

// Package calendar is her Google Calendar: the events bizzy reads and
// writes, and the title syntax that turns an event into a session or a
// follow-up.
package calendar

import (
	"time"

	"bizzy-lambda/internal/platform/apperr"
)

var (
	ErrGone    = apperr.NotFound("That event is no longer in the calendar.")
	ErrChanged = apperr.Conflict("This session was changed in the calendar meanwhile. Check the latest and try again.")
)

// Event is the part of a Google Calendar event the sync cares about. With
// singleEvents=true each recurring instance arrives with its own ID.
type Event struct {
	ID    string
	Title string
	// Start and End are set for a timed event.
	Start time.Time
	End   time.Time
	// Date is the day of an all-day event, YYYY-MM-DD.
	Date        string
	Description string
	// ColorID is the event's own colour ("" for the calendar's default):
	// hers, never read or written by bizzy.
	ColorID   string
	AllDay    bool
	Cancelled bool
	// Private holds bizzy's own properties on the event, which she never
	// sees (extendedProperties.private); see the Prop constants.
	Private map[string]string
	// ETag is the version read; a write against an older one is refused.
	ETag string
}

// Private properties bizzy keeps on events it writes.
const (
	// PropSession is on a session's own event: the session it shows. A sync
	// that finds an event it has no link for, carrying this, links it
	// rather than reading it as a new booking (the app died between writing
	// the event and recording it). PropFollowUp is the same for a
	// follow-up's event.
	PropSession  = "bizzySession"
	PropFollowUp = "bizzyFollowUp"
)

// Snapshot is the part of an event that bizzy writes and reads: what a
// calendar edit can change. Description is set only for events whose
// description is bizzy's (a follow-up's notes); a session's is hers.
type Snapshot struct {
	Title string    `json:"title" dynamodbav:"title"`
	Start time.Time `json:"start,omitzero" dynamodbav:"start,omitempty"`
	End   time.Time `json:"end,omitzero" dynamodbav:"end,omitempty"`
	// Date is the day of an all-day event (YYYY-MM-DD), in place of Start
	// and End.
	Date        string  `json:"date,omitempty" dynamodbav:"date,omitempty"`
	Description *string `json:"description,omitempty" dynamodbav:"description,omitempty"`
}

// SnapshotOf is what an event says, as a snapshot, its description left
// out.
func SnapshotOf(e Event) Snapshot {
	if e.AllDay {
		return Snapshot{Title: e.Title, Date: e.Date}
	}
	return Snapshot{Title: e.Title, Start: e.Start.UTC(), End: e.End.UTC()}
}

// NotedSnapshotOf is what an event says with its description, for events
// whose description is bizzy's.
func NotedSnapshotOf(e Event) Snapshot {
	s := SnapshotOf(e)
	d := e.Description
	s.Description = &d
	return s
}

// Same reports whether two snapshots say the same thing, whatever the time
// zones they were read in.
func (s Snapshot) Same(other Snapshot) bool {
	sameDescription := (s.Description == nil) == (other.Description == nil) &&
		(s.Description == nil || *s.Description == *other.Description)
	return s.Title == other.Title && s.Start.Equal(other.Start) && s.End.Equal(other.End) && s.Date == other.Date && sameDescription
}

// Input writes the snapshot as an event.
func (s Snapshot) Input() EventInput {
	in := EventInput{Title: s.Title, Date: s.Date, Description: s.Description}
	if s.Date == "" {
		in.Start, in.End = s.Start.UTC(), s.End.UTC()
	}
	return in
}

// Link is the event that shows something of bizzy's in the calendar (a
// session, a follow-up), which lets her change it there too (see
// googlesync). Seen is what the event said when bizzy and the calendar last
// agreed: a sync reads an event that differs from it as her edit.
type Link struct {
	// EventID is "" until the event is written.
	EventID string    `json:"eventId,omitempty" dynamodbav:"eventId,omitempty"`
	Seen    *Snapshot `json:"seen,omitempty" dynamodbav:"seen,omitempty"`
	// Pending says the event doesn't show the session as it is yet: the
	// next push writes it.
	Pending bool `json:"pending,omitempty" dynamodbav:"pending,omitempty"`
}

// EventInput is what the app writes to an event. Anything else on the event
// (its colour, reminders, guests, and the description unless given) is left
// as it is.
type EventInput struct {
	Title string
	Start time.Time
	End   time.Time
	// Date, when set, makes it an all-day event on that day (YYYY-MM-DD)
	// instead of Start to End.
	Date string
	// Description replaces the event's description when not nil.
	Description *string
	// Private sets bizzy's own properties, leaving others as they are.
	Private map[string]string
}

// Calendar is one of her calendars, to choose which one the sync reads.
type Calendar struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Primary bool   `json:"primary,omitempty"`
}

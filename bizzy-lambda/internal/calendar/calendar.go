// Package calendar is the user's Google Calendar as bizzy sees it: events,
// the title syntax that turns an event into a session (syntax.go), and the
// Calendar the sync reads and writes (Google in production, fakecal in
// tests). It knows nothing of sessions: googlesync maps sessions to events
// and back.
package calendar

import (
	"context"
	"time"

	"bizzy-lambda/internal/platform/apperr"
)

var (
	ErrGone    = apperr.NotFound("That event is no longer in the calendar.")
	ErrChanged = apperr.Conflict("The event was changed in the calendar meanwhile.")
)

// Calendar is the calendar the user chose in Settings.
type Calendar interface {
	// ID names the calendar.
	ID() string
	// Changed lists the events that end after from and start before to
	// (either zero: no bound). With since, only those changed at or after
	// it, deleted ones coming back Cancelled; without, every event still
	// there.
	Changed(ctx context.Context, since, from, to time.Time) ([]Event, error)
	// Earliest is when the earliest event starting before a time starts;
	// false when there is none.
	Earliest(ctx context.Context, before time.Time) (time.Time, bool, error)
	// Get reads one event; a deleted one comes back Cancelled.
	Get(ctx context.Context, id string) (Event, error)
	Insert(ctx context.Context, in EventInput) (Event, error)
	// Update and Delete act only if the event is still at etag;
	// ErrChanged otherwise.
	Update(ctx context.Context, id, etag string, in EventInput) (Event, error)
	Delete(ctx context.Context, id, etag string) error
}

// Event is the part of a Google Calendar event bizzy reads. Each instance
// of a recurring event arrives on its own, with its own ID.
type Event struct {
	ID    string
	Title string
	// Start and End are set for a timed event; Date (YYYY-MM-DD) for an
	// all-day one.
	Start  time.Time
	End    time.Time
	Date   string
	AllDay bool
	// Description is the user's, never written by bizzy for a session.
	Description string
	Cancelled   bool
	// Private holds bizzy's own properties on the event, which the user
	// never sees (see PropSession).
	Private map[string]string
	// ETag is the version read; Updated when it last changed.
	ETag    string
	Updated time.Time
}

// At is when an event starts: its start, or its day.
func (e Event) At() time.Time {
	if e.AllDay {
		day, _ := time.Parse(time.DateOnly, e.Date)
		return day
	}
	return e.Start
}

// PropSession is on every event bizzy writes for a session: the session
// it shows. A sync that finds it on an event no session links to links it
// (the request died between writing the event and recording it).
// PropFollowUp is the same for a follow-up's event.
const (
	PropSession  = "bizzySession"
	PropFollowUp = "bizzyFollowUp"
)

// Snapshot is the part of an event bizzy writes and reads: what an edit in
// the calendar can change.
type Snapshot struct {
	Title string    `json:"title"`
	Start time.Time `json:"start,omitzero"`
	End   time.Time `json:"end,omitzero"`
	// Date is the day of an all-day event, in place of Start and End.
	Date string `json:"date,omitempty"`
	// Description is set only for an event whose description is bizzy's
	// (a follow-up's notes); a session's is the user's.
	Description *string `json:"description,omitempty"`
}

// SnapshotOf is what an event says, its description left out.
func SnapshotOf(e Event) Snapshot {
	if e.AllDay {
		return Snapshot{Title: e.Title, Date: e.Date}
	}
	return Snapshot{Title: e.Title, Start: e.Start.UTC(), End: e.End.UTC()}
}

// NotedSnapshotOf is what an event says with its description, for one
// whose description is bizzy's.
func NotedSnapshotOf(e Event) Snapshot {
	s := SnapshotOf(e)
	d := e.Description
	s.Description = &d
	return s
}

// Same reports whether two snapshots say the same, whatever the time zones
// they were read in.
func (s Snapshot) Same(o Snapshot) bool {
	sameDescription := (s.Description == nil) == (o.Description == nil) && (s.Description == nil || *s.Description == *o.Description)
	return s.Title == o.Title && s.Start.Equal(o.Start) && s.End.Equal(o.End) && s.Date == o.Date && sameDescription
}

// Input writes the snapshot as an event.
func (s Snapshot) Input() EventInput {
	return EventInput{Title: s.Title, Start: s.Start, End: s.End, Date: s.Date, Description: s.Description}
}

// Writable reports whether a client's name reads back as itself in a
// session's title and a follow-up's: one ending like an amount ("Kid 2")
// would read back as a fee, one with a colon cut at it.
func Writable(name string) bool {
	t, err := ParseTitle(FormatTitle(Title{Name: name}))
	f, errF := ParseFollowUp(FormatFollowUp(FollowUpTitle{Name: name}))
	return err == nil && t.Name == name && errF == nil && f.Name == name
}

// EventInput is what bizzy writes to an event. Anything else on it (its
// colour, reminders, guests, description) is left as it is.
type EventInput struct {
	Title string
	Start time.Time
	End   time.Time
	// Date, when set, makes it an all-day event on that day.
	Date string
	// Description replaces the event's description when not nil.
	Description *string
	// Private sets bizzy's own properties, leaving others as they are.
	Private map[string]string
}

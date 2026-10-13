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
	// ColorID is the event's own colour ("" for the calendar's default).
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
	// PropSessionID links a follow-up to the session it was made from.
	PropSessionID = "bizzySessionId"
)

// EventInput is what the app writes to an event. Anything else on the event
// (reminders, guests, and the description unless given) is left as it is.
type EventInput struct {
	Title string
	Start time.Time
	End   time.Time
	// Date, when set, makes it an all-day event on that day (YYYY-MM-DD)
	// instead of Start to End.
	Date string
	// ColorID "" clears the event's own colour.
	ColorID string
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

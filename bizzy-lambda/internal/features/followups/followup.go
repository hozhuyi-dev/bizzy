// Package followups is the user's reminders to get back to a client. Each
// shows in the calendar as an event titled `! Name: summary`, its notes the
// event's description, so it can be made or changed there too (see
// googlesync); marking one done is the app's alone.
package followups

import (
	"time"

	"bizzy-lambda/internal/platform/txn"
)

type FollowUp struct {
	ID       string `json:"id"`
	ClientID string `json:"clientId"`
	// SessionID is the session it was made from, if any: a note of where
	// it came from, kept when the session goes.
	SessionID string `json:"sessionId,omitempty"`
	// Due is when it is due: a time, or for an all-day one the start of
	// its day in the user's time zone.
	Due    time.Time `json:"due"`
	AllDay bool      `json:"allDay,omitempty"`
	// Minutes is how long its event blocks in the calendar; 0 when
	// all-day.
	Minutes   int        `json:"minutes,omitempty"`
	Summary   string     `json:"summary,omitempty"`
	Notes     string     `json:"notes,omitempty"`
	DoneAt    *time.Time `json:"doneAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

// FollowUps are filed by client and due time, open until done, and by the
// session they were made from.
var FollowUps = txn.Kind[FollowUp]{
	Name: "FOLLOWUP", Gone: "This follow-up was deleted.",
	Doc: txn.Doc{What: "A reminder to get back to a client.", Client: "its client, by when due", Time: "when it is due", Open: "not done yet", Ref: "the session it was made from"},
	Meta: func(f *FollowUp) txn.Meta {
		return txn.Meta{ID: f.ID, Client: f.ClientID, Time: f.Due, Open: f.DoneAt == nil, Ref: f.SessionID}
	},
}

// DefaultMinutes is how long a timed follow-up blocks in the calendar
// unless said.
const DefaultMinutes = 15

// End is when its event ends, for a timed one.
func (f FollowUp) End() time.Time {
	return f.Due.Add(time.Duration(f.Minutes) * time.Minute)
}

// Date is the day it is due, in the user's time zone.
func (f FollowUp) Date(loc *time.Location) string {
	return f.Due.In(loc).Format(time.DateOnly)
}

// Reason is why a follow-up is on the to-do list.
type Reason string

// ReasonFollowUp: get back to the client.
const ReasonFollowUp Reason = "followUp"

// Todo is what is left to do on it as of now, looking ahead days.
func (f FollowUp) Todo(now time.Time, aheadDays int) []Reason {
	out := []Reason{}
	if f.DoneAt == nil && !f.Due.After(now.AddDate(0, 0, aheadDays)) {
		out = append(out, ReasonFollowUp)
	}
	return out
}

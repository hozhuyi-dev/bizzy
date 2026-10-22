// Package conflicts is the user's edits in the calendar that bizzy refused:
// each waits on the to-do list, with why and the remedies that would let it
// through, until the user fixes it (in the app or the calendar) and it is
// applied (once the app changes what refused it, the next sync, or
// conflicts.apply), or bizzy's version is put back (calendar.revert): for
// an event that shows nothing of bizzy's, that deletes it, as every event
// in the calendar is bizzy's.
//
// The app can't make one: it refuses a change before anything is written.
// Only the calendar, edited directly, can ask for what isn't allowed.
package conflicts

import (
	"time"

	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

type Conflict struct {
	// EventID is the event the user edited.
	EventID string `json:"eventId"`
	// ItemKind and ItemID are what it shows ("session", "followUp"); ""
	// for a new event.
	ItemKind string `json:"itemKind,omitempty"`
	ItemID   string `json:"itemId,omitempty"`
	// Shown is what the event says, which bizzy refused; Gone says the
	// user deleted it.
	Shown    calendar.Snapshot `json:"shown"`
	Gone     bool              `json:"gone,omitempty"`
	Message  string            `json:"message"`
	Remedies []apperr.Remedy   `json:"remedies"`
	// Since is when it was first refused.
	Since time.Time `json:"since"`
}

var Conflicts = txn.Kind[Conflict]{
	Name: "CONFLICT", Gone: "That edit was already settled.",
	Doc: txn.Doc{What: "An edit made in the calendar that bizzy refused, keyed by its event.", Time: "when it was first refused", Open: "every one: it waits on the to-do list", Ref: "the session or follow-up its event shows"},
	Meta: func(c *Conflict) txn.Meta {
		return txn.Meta{ID: c.EventID, Time: c.Since, Open: true, Ref: c.ItemID}
	},
	Whole: true,
}

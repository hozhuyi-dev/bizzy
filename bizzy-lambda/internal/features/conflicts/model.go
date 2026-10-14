// Package conflicts holds the edits she made in a Google app that bizzy
// didn't apply, and what each Google record shows.
//
// Google Calendar (and, next, Google Contacts) is somewhere she can change
// things, not where they are true: bizzy is. Each record there that shows
// something of bizzy's is looked up by an External. A sync reads a change
// to one as the command she means (see googlesync), decided by the same
// guards as the app's; one they refuse is kept as a Conflict, changing
// nothing, until she undoes it there, restores the record, or does it the
// way the guards offer (each refusal's remedies).
//
// Both are keyed by the surface the record lives on and its id there, so
// a new surface or kind of record plugs in without a new table design.
package conflicts

import (
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/platform/command"
)

// Surface is a Google app she edits records in.
type Surface string

const (
	SurfaceCalendar Surface = "calendar"
)

// Key names a record on a surface: "calendar#<eventId>".
func Key(surface Surface, externalID string) string {
	return string(surface) + "#" + externalID
}

// ExternalKind is what a record shows.
type ExternalKind string

const (
	// ShowsSession: the event is a session's.
	ShowsSession ExternalKind = "session"
	// ShowsFollowUp: the event is a follow-up's.
	ShowsFollowUp ExternalKind = "followUp"
	// Ignored: she said the event is not bizzy's (a personal one).
	Ignored ExternalKind = "ignored"
)

// External is what one record on a surface shows.
type External struct {
	Surface    Surface      `json:"surface" dynamodbav:"surface"`
	ExternalID string       `json:"externalId" dynamodbav:"externalId"`
	Kind       ExternalKind `json:"kind" dynamodbav:"kind"`
	// ID is the session or follow-up it shows; "" when ignored.
	ID string `json:"id,omitempty" dynamodbav:"id,omitempty"`
}

func (e External) Key() string { return Key(e.Surface, e.ExternalID) }

// Kind is what her edit did to the record.
type Kind string

const (
	// KindNew: a record bizzy didn't know, which can't be read as one.
	KindNew Kind = "new"
	// KindChanged: a record she changed.
	KindChanged Kind = "changed"
	// KindGone: a record she deleted.
	KindGone Kind = "gone"
)

// Conflict is an edit on a surface that wasn't applied.
type Conflict struct {
	Key        string  `json:"key" dynamodbav:"key"`
	Surface    Surface `json:"surface" dynamodbav:"surface"`
	ExternalID string  `json:"externalId" dynamodbav:"externalId"`
	Kind       Kind    `json:"kind" dynamodbav:"kind"`
	// TargetKind and TargetID are what the record shows (its External's
	// kind and id); empty for a new record.
	TargetKind string `json:"targetKind,omitempty" dynamodbav:"targetKind,omitempty"`
	TargetID   string `json:"targetId,omitempty" dynamodbav:"targetId,omitempty"`
	// ClientID is whose it is, when known.
	ClientID string `json:"clientId,omitempty" dynamodbav:"clientId,omitempty"`

	// Seen is the event as bizzy and the calendar last agreed, and Now as
	// she left it (nil when deleted).
	Seen *calendar.Snapshot `json:"seen,omitempty" dynamodbav:"seen,omitempty"`
	Now  *calendar.Snapshot `json:"now,omitempty" dynamodbav:"now,omitempty"`
	// Asks says what the edit asks for, in words.
	Asks []string `json:"asks" dynamodbav:"asks"`
	// Violations are why it wasn't applied, each with its remedies.
	Violations []command.Violation `json:"violations" dynamodbav:"violations"`

	// At is when it was first found.
	At      time.Time `json:"at" dynamodbav:"at"`
	Version int       `json:"version" dynamodbav:"version"`
}

// Remedies are the actions its violations offer, each once.
func (c Conflict) Remedies() []command.Remedy {
	var out []command.Remedy
	seen := map[command.Remedy]bool{}
	for _, v := range c.Violations {
		for _, r := range v.Remedies {
			if !seen[r] {
				seen[r] = true
				out = append(out, r)
			}
		}
	}
	return out
}

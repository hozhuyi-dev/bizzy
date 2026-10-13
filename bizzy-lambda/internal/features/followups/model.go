// Package followups holds her reminders to get back to a client: events in
// the sessions calendar titled `! Name: summary` (see calendar.ParseFollowUp),
// with longer notes in the event's description. They come from the calendar
// like sessions do, or are made in the app (often from a session, which the
// event then remembers). Marking one done is hers and lives only here.
package followups

import (
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
)

// FollowUp is keyed by the Google event instance ID.
type FollowUp struct {
	EventID string `json:"eventId" dynamodbav:"eventId"`

	// From the calendar (sync).
	Title string `json:"title" dynamodbav:"title"`
	// Due is the start of a timed event, or the start of the day (in her
	// time zone) of an all-day one.
	Due    time.Time `json:"due" dynamodbav:"due"`
	AllDay bool      `json:"allDay,omitempty" dynamodbav:"allDay,omitempty"`
	// Notes is the event's description.
	Notes string `json:"notes,omitempty" dynamodbav:"notes,omitempty"`
	// SessionID is the session it was made from, kept on the event.
	SessionID string `json:"sessionId,omitempty" dynamodbav:"sessionId,omitempty"`

	// Derived from the title.
	Name              string `json:"name,omitempty" dynamodbav:"name,omitempty"`
	Summary           string `json:"summary,omitempty" dynamodbav:"summary,omitempty"`
	ClientID          string `json:"clientId,omitempty" dynamodbav:"clientId,omitempty"`
	SuggestedClientID string `json:"suggestedClientId,omitempty" dynamodbav:"suggestedClientId,omitempty"`
	// Problem says why the title can't be read or matched.
	Problem string `json:"problem,omitempty" dynamodbav:"problem,omitempty"`

	// Hers.
	DoneAt *time.Time `json:"doneAt,omitempty" dynamodbav:"doneAt,omitempty"`

	Version int `json:"version" dynamodbav:"version"`
}

// FromEvent copies what the calendar says onto a follow-up (stored, or new
// when zero) and derives the rest, keeping her own fields.
func FromEvent(stored FollowUp, event calendar.Event, aliases clients.Aliases, loc *time.Location) FollowUp {
	f := stored
	f.EventID, f.Title, f.Notes = event.ID, event.Title, event.Description
	f.SessionID = event.Private[calendar.PropSessionID]
	f.AllDay = event.AllDay
	if event.AllDay {
		day, _ := time.ParseInLocation(time.DateOnly, event.Date, loc)
		f.Due = day.UTC()
	} else {
		f.Due = event.Start.UTC()
	}
	return f.Match(aliases)
}

// Match re-reads the title against the clients' aliases: who it is for, or
// why no one.
func (f FollowUp) Match(aliases clients.Aliases) FollowUp {
	f.Name, f.Summary, f.ClientID, f.SuggestedClientID, f.Problem = "", "", "", "", ""
	title, err := calendar.ParseFollowUp(f.Title)
	f.Name, f.Summary = title.Name, title.Summary
	if err != nil {
		f.Problem = err.Error()
		return f
	}
	match := clients.MatchName(title.Name, aliases)
	switch match.Kind {
	case clients.MatchExact:
		f.ClientID = match.ClientID
	case clients.MatchNearMiss:
		f.SuggestedClientID = match.ClientID
		f.Problem = "The name is close to a client's, but not the same"
	default:
		f.Problem = "No client has this name"
	}
	return f
}

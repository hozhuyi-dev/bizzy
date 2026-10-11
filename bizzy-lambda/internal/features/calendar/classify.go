package calendar

import (
	"errors"
	"time"
)

// Event is the part of a Google Calendar event the sync cares about. With
// singleEvents=true each recurring instance arrives with its own ID.
type Event struct {
	ID    string
	Title string
	Start time.Time
	End   time.Time
	// ColorID is the event's own colour ("" for the calendar's default).
	ColorID   string
	AllDay    bool
	Cancelled bool
}

// Outcome is what a calendar event becomes.
type Outcome int

const (
	// OutcomeSkip is not a session: a personal event, an all-day event, or a
	// cancelled one. Nothing about it is stored.
	OutcomeSkip Outcome = iota
	// OutcomeSession matched a client and is ready for billing rules.
	OutcomeSession
	// OutcomeUnmatched looks like a session, or names one of her contacts,
	// but matched no client exactly; she links or creates the client in the
	// app.
	OutcomeUnmatched
	// OutcomeParseError looks like a session but the title is malformed.
	OutcomeParseError
)

type Classification struct {
	Outcome Outcome
	Title   Title
	Match   Match
	// Contacts are the Google contacts the name may refer to, when it matched
	// no client exactly.
	Contacts []string
	// Reason is set for OutcomeParseError.
	Reason string
}

// suggestionLimit caps the contacts suggested for one name.
const suggestionLimit = 3

// Classify decides what an event is, using only its title, the known
// aliases and her contacts' names (people may be nil). It is pure so the
// rules can be tested without Google or DynamoDB.
//
// A timed event is a session candidate when its name matches a client alias,
// nearly matches one, names one of her contacts, or the title is
// session-shaped (a `?` prefix or trailing amount/package). Everything else
// is skipped.
func Classify(event Event, aliases Aliases, people People) Classification {
	if event.AllDay || event.Cancelled {
		return Classification{Outcome: OutcomeSkip}
	}

	title, err := ParseTitle(event.Title)
	if err != nil {
		var parseErr *ParseError
		if errors.As(err, &parseErr) {
			return Classification{Outcome: OutcomeParseError, Title: title, Reason: parseErr.Reason}
		}
		return Classification{Outcome: OutcomeParseError, Title: title, Reason: err.Error()}
	}

	match := MatchName(title.Name, aliases)
	if match.Kind == MatchExact {
		return Classification{Outcome: OutcomeSession, Title: title, Match: match}
	}

	contacts := MatchPeople(title.Name, people, suggestionLimit)
	switch {
	case match.Kind == MatchNearMiss, title.SessionShaped(), len(contacts) > 0:
		return Classification{Outcome: OutcomeUnmatched, Title: title, Match: match, Contacts: contacts}
	default:
		return Classification{Outcome: OutcomeSkip}
	}
}

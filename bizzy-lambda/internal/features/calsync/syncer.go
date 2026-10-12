// Package calsync imports the calendar into sessions, and refreshes each
// client's copy of their Google contact. It re-reads a fixed window on every
// run instead of using sync tokens: running twice is harmless and a missed
// day heals itself.
package calsync

import (
	"context"
	"time"

	"bizzy-lambda/internal/features/billing"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/sessions"
)

type EventSource interface {
	Events(ctx context.Context, from, to time.Time) ([]calendar.Event, error)
}

// ContactSource lists her Google contacts.
type ContactSource interface {
	List(ctx context.Context) ([]contacts.Person, error)
}

type ClientStore interface {
	List(ctx context.Context) ([]clients.Client, error)
	SetNextBooked(ctx context.Context, id string, at *time.Time) error
	RefreshContact(ctx context.Context, id string, previous, next clients.Contact) (bool, error)
}

type SessionStore interface {
	Get(ctx context.Context, eventID string) (sessions.Session, bool, error)
	ListByTime(ctx context.Context, from, to time.Time) ([]sessions.Session, error)
}

type Reconciler interface {
	Reconcile(ctx context.Context, scope billing.Scope) (billing.Result, error)
}

type StatusStore interface {
	Put(ctx context.Context, run Run) error
}

type Syncer struct {
	Events EventSource
	// Contacts may be nil, which skips refreshing clients' contact copies.
	Contacts ContactSource
	Clients  ClientStore
	Sessions SessionStore
	Billing  Reconciler
	Status   StatusStore
	// Window is how far back each run re-reads; Lookahead how far forward it
	// looks for bookings (which never become sessions).
	Window    time.Duration
	Lookahead time.Duration
	Now       func() time.Time
}

type Summary struct {
	// Sessions is how many timed events the window holds.
	Sessions int `json:"sessions"`
	// Writes this run made.
	Saved   int `json:"saved"`
	Deleted int `json:"deleted"`
	// Contacts is how many clients' contact copies changed.
	Contacts int `json:"contacts"`
}

// Run is the record of the last sync, shown in the app.
type Run struct {
	At      time.Time `json:"at" dynamodbav:"at"`
	Summary Summary   `json:"summary" dynamodbav:"summary"`
	// Error is why the run failed, e.g. Google was disconnected.
	Error string `json:"error,omitempty" dynamodbav:"error,omitempty"`
}

func (s Syncer) Run(ctx context.Context) (Summary, error) {
	var summary Summary

	all, err := s.Clients.List(ctx)
	if err != nil {
		return summary, err
	}
	aliases := calendar.AliasesOf(all)

	now := s.Now().UTC()
	from := now.Add(-s.Window)

	if err := s.refreshContacts(ctx, all, now, &summary); err != nil {
		return summary, err
	}

	events, err := s.Events.Events(ctx, from, now)
	if err != nil {
		return summary, err
	}
	stored, err := s.Sessions.ListByTime(ctx, from, now)
	if err != nil {
		return summary, err
	}
	byID := make(map[string]sessions.Session, len(stored))
	for _, st := range stored {
		byID[st.EventID] = st
	}

	var changes []billing.Change
	seen := map[string]bool{}

	// Every timed event on her sessions calendar is a session; the billing
	// reconcile works out whether it needs fixing.
	for _, event := range events {
		if !isSession(event) {
			continue
		}
		summary.Sessions++
		seen[event.ID] = true

		before, ok := byID[event.ID]
		if !ok {
			// Moved in from outside the window: same event, same item.
			if before, ok, err = s.Sessions.Get(ctx, event.ID); err != nil {
				return summary, err
			}
		}
		if change, changed := eventChange(&event, optional(before, ok)); changed {
			changes = append(changes, change)
		}
	}

	// Stored sessions the calendar no longer has in the window: deleted,
	// cancelled, moved out, or made all-day.
	for id, before := range byID {
		if seen[id] {
			continue
		}
		if change, changed := eventChange(nil, &before); changed {
			changes = append(changes, change)
		}
	}

	if len(changes) > 0 {
		result, err := s.Billing.Reconcile(ctx, billing.Scope{Changes: changes})
		if err != nil {
			return summary, err
		}
		summary.Saved, summary.Deleted = result.Saved, result.Deleted
	}

	if s.Lookahead > 0 {
		if err := s.updateBookings(ctx, all, aliases, now); err != nil {
			return summary, err
		}
	}

	if s.Status != nil {
		if err := s.Status.Put(ctx, Run{At: now, Summary: summary}); err != nil {
			return summary, err
		}
	}
	return summary, nil
}

// isSession reports whether an event is a session: every timed event on her
// sessions calendar is one.
func isSession(event calendar.Event) bool {
	return !event.AllDay && !event.Cancelled
}

func optional(s sessions.Session, ok bool) *sessions.Session {
	if !ok {
		return nil
	}
	return &s
}

// eventChange is what an event means for the session stored for it: before
// is nil when none is stored, and event nil when the event is no longer a
// session. It reports false when nothing changed.
func eventChange(event *calendar.Event, before *sessions.Session) (billing.Change, bool) {
	if event == nil {
		switch {
		case before == nil:
			return billing.Change{}, false
		case before.Document == nil:
			return billing.Change{Before: before}, true
		case before.Removed:
			return billing.Change{}, false
		default:
			// A receipt keeps the session, marked removed.
			after := *before
			after.Removed = true
			return billing.Change{Before: before, After: &after}, true
		}
	}

	var after sessions.Session
	if before != nil {
		after = *before
	}
	after.EventID = event.ID
	after.Title, after.Start, after.End, after.ColorID = event.Title, event.Start.UTC(), event.End.UTC(), event.ColorID
	after.Removed = false

	if before == nil {
		return billing.Change{After: &after}, true
	}
	return billing.Change{Before: before, After: &after}, calendarChanged(*before, after)
}

func calendarChanged(before, after sessions.Session) bool {
	return before.Title != after.Title ||
		!before.Start.Equal(after.Start) ||
		!before.End.Equal(after.End) ||
		before.ColorID != after.ColorID ||
		before.Removed != after.Removed
}

// refreshContacts reads her contacts and refreshes each client's copy.
func (s Syncer) refreshContacts(ctx context.Context, all []clients.Client, now time.Time, summary *Summary) error {
	if s.Contacts == nil {
		return nil
	}

	people, err := s.Contacts.List(ctx)
	if err != nil {
		return err
	}
	byResource := make(map[string]contacts.Person, len(people))
	for _, p := range people {
		byResource[p.ResourceName] = p
	}

	for _, client := range all {
		if client.Contact == nil {
			continue
		}
		previous := *client.Contact
		next := previous
		if p, ok := byResource[previous.ResourceName]; ok {
			next = p.Link(now)
		} else {
			// Deleted or merged in Google: keep the copy, so she can
			// recreate the contact from it.
			next.Missing = true
		}
		if next.SameDetails(previous) {
			continue
		}
		wrote, err := s.Clients.RefreshContact(ctx, client.ID, previous, next)
		if err != nil {
			return err
		}
		if wrote {
			summary.Contacts++
		}
	}
	return nil
}

// updateBookings records each client's next booked session, so a client
// who has already rebooked is not on the follow-up list.
func (s Syncer) updateBookings(ctx context.Context, all []clients.Client, aliases calendar.Aliases, now time.Time) error {
	events, err := s.Events.Events(ctx, now, now.Add(s.Lookahead))
	if err != nil {
		return err
	}

	next := map[string]time.Time{}
	for _, event := range events {
		if !isSession(event) || !event.Start.After(now) {
			continue
		}
		title, err := calendar.ParseTitle(event.Title)
		if err != nil {
			continue
		}
		match := calendar.MatchName(title.Name, aliases)
		if match.Kind != calendar.MatchExact {
			continue
		}
		id := match.ClientID
		if at, ok := next[id]; !ok || event.Start.Before(at) {
			next[id] = event.Start.UTC()
		}
	}

	for _, client := range all {
		at, booked := next[client.ID]
		switch {
		case booked && (client.NextBookedAt == nil || !client.NextBookedAt.Equal(at)):
			if err := s.Clients.SetNextBooked(ctx, client.ID, &at); err != nil {
				return err
			}
		case !booked && client.NextBookedAt != nil:
			if err := s.Clients.SetNextBooked(ctx, client.ID, nil); err != nil {
				return err
			}
		}
	}
	return nil
}

// Package googlesync keeps bizzy in step with her Google account. The sync
// imports the calendar into sessions and follow-ups and refreshes each
// client's copy of their Google contact; the editors write sessions and
// follow-ups she changes in the app to the calendar first. Each sync
// re-reads a range of the calendar instead of using sync tokens, so running
// twice is harmless and no state is kept between runs.
package googlesync

import (
	"context"
	"errors"
	"time"

	"bizzy-lambda/internal/features/billing"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/dynamo"
)

// SyncWindow is how far back a run re-reads the calendar unless she picks
// the dates.
const SyncWindow = 60 * 24 * time.Hour

// Lookahead is how far ahead every run reads, whatever its range: bookings
// are sessions too, and an unconfirmed one goes on her to-do list a few
// days before it.
const Lookahead = 60 * 24 * time.Hour

// Range is the stretch of calendar a run re-reads. A zero From reads from
// the start of the calendar; a zero To reads up to Lookahead from now.
type Range struct {
	From time.Time
	To   time.Time
}

// EventSource lists events starting in [from, to); a zero from reads from
// the start of the calendar.
type EventSource interface {
	Events(ctx context.Context, from, to time.Time) ([]calendar.Event, error)
}

// ContactSource lists her Google contacts.
type ContactSource interface {
	List(ctx context.Context) ([]contacts.Person, error)
}

type ClientStore interface {
	List(ctx context.Context) ([]clients.Client, error)
	RefreshContact(ctx context.Context, id string, previous, next clients.Contact) (bool, error)
}

type SessionStore interface {
	Get(ctx context.Context, eventID string) (sessions.Session, bool, error)
	ListByTime(ctx context.Context, from, to time.Time) ([]sessions.Session, error)
}

type FollowUpStore interface {
	Get(ctx context.Context, eventID string) (followups.FollowUp, bool, error)
	ListByTime(ctx context.Context, from, to time.Time) ([]followups.FollowUp, error)
	Save(ctx context.Context, f followups.FollowUp) (followups.FollowUp, error)
	Delete(ctx context.Context, eventID string) error
}

type Reconciler interface {
	Reconcile(ctx context.Context, scope billing.Scope) (billing.Result, error)
}

// EditorBilling is the reconcile, and what it would make of an edit before
// it is written.
type EditorBilling interface {
	Reconciler
	BookingImpact(ctx context.Context, eventID string, event calendar.Event, updatePayment bool) (sessions.Session, []billing.Brought, error)
	DeletionImpact(ctx context.Context, eventID string, deletePackage bool) (billing.Impact, error)
}

type StatusStore interface {
	Put(ctx context.Context, run Run) error
}

type Syncer struct {
	Events EventSource
	// Contacts may be nil, which skips refreshing clients' contact copies.
	Contacts  ContactSource
	Clients   ClientStore
	Sessions  SessionStore
	FollowUps FollowUpStore
	Billing   Reconciler
	Status    StatusStore
	// Location is her time zone, which all-day follow-ups fall in.
	Location *time.Location
	Now      func() time.Time
}

func (s Syncer) Run(ctx context.Context, r Range) (Summary, error) {
	var summary Summary

	all, err := s.Clients.List(ctx)
	if err != nil {
		return summary, err
	}

	now := s.Now().UTC()
	from, to := r.From, now.Add(Lookahead)
	if !r.To.IsZero() && r.To.Before(to) {
		to = r.To
	}

	if err := s.refreshContacts(ctx, all, now, &summary); err != nil {
		return summary, err
	}

	events, err := s.Events.Events(ctx, from, to)
	if err != nil {
		return summary, err
	}
	// ListByTime includes its end; the calendar's range does not.
	stored, err := s.Sessions.ListByTime(ctx, from, to.Add(-time.Second))
	if err != nil {
		return summary, err
	}
	byID := make(map[string]sessions.Session, len(stored))
	for _, st := range stored {
		byID[st.EventID] = st
	}

	var changes []billing.Change
	seen := map[string]bool{}

	// Every timed event on her sessions calendar is a session, bar
	// follow-ups; the billing reconcile works out whether it needs fixing.
	for _, event := range events {
		if !isSession(event) {
			continue
		}
		summary.Sessions++
		seen[event.ID] = true

		before, ok := byID[event.ID]
		if !ok {
			// Moved in from outside the range: same event, same item.
			if before, ok, err = s.Sessions.Get(ctx, event.ID); err != nil {
				return summary, err
			}
		}
		if !ok || changed(before, event, now) {
			changes = append(changes, billing.Change{EventID: event.ID, Event: &event})
		}
	}

	// Stored sessions the calendar no longer has in the range: deleted,
	// cancelled, moved out, made all-day, or now a follow-up.
	for id, before := range byID {
		if !seen[id] && before.RemovedAt == nil {
			changes = append(changes, billing.Change{EventID: id})
		}
	}

	if len(changes) > 0 {
		result, err := s.Billing.Reconcile(ctx, billing.Scope{Changes: changes})
		if err != nil {
			return summary, err
		}
		summary.Saved, summary.Deleted = result.Saved, result.Deleted
	}

	if err := s.syncFollowUps(ctx, events, from, to, clients.AliasesOf(all), &summary); err != nil {
		return summary, err
	}

	if s.Status != nil {
		if err := s.Status.Put(ctx, Run{At: now, Summary: summary}); err != nil {
			return summary, err
		}
	}
	return summary, nil
}

// isSession reports whether an event is a session: every timed event on her
// sessions calendar is one, except follow-ups.
func isSession(event calendar.Event) bool {
	return !event.AllDay && !event.Cancelled && !calendar.IsFollowUp(event.Title)
}

// isFollowUp reports whether an event is a follow-up, timed or all-day.
func isFollowUp(event calendar.Event) bool {
	return !event.Cancelled && calendar.IsFollowUp(event.Title)
}

// changed reports whether a stored session needs reconciling: its event
// changed, or it has happened since.
func changed(before sessions.Session, event calendar.Event, now time.Time) bool {
	return calendarChanged(before, event) || (before.Upcoming && !event.Start.After(now))
}

// calendarChanged reports whether the event says something else than the
// stored session, or it was deleted and is back.
func calendarChanged(before sessions.Session, event calendar.Event) bool {
	return before.Title != event.Title ||
		!before.Start.Equal(event.Start) ||
		!before.End.Equal(event.End) ||
		before.ColorID != event.ColorID ||
		before.RemovedAt != nil
}

// syncFollowUps stores the follow-up events in the range and removes the
// ones gone from it. Marking one done is hers and is kept.
func (s Syncer) syncFollowUps(ctx context.Context, events []calendar.Event, from, to time.Time, aliases clients.Aliases, summary *Summary) error {
	stored, err := s.FollowUps.ListByTime(ctx, from, to.Add(-time.Second))
	if err != nil {
		return err
	}
	byID := make(map[string]followups.FollowUp, len(stored))
	for _, f := range stored {
		byID[f.EventID] = f
	}

	seen := map[string]bool{}
	for _, event := range events {
		if !isFollowUp(event) {
			continue
		}
		seen[event.ID] = true
		if before, ok := byID[event.ID]; ok && dynamo.Same(before, followups.FromEvent(before, event, aliases, s.Location)) {
			continue
		}
		if _, err := s.saveFollowUp(ctx, event, aliases); err != nil {
			return err
		}
		summary.FollowUps++
	}

	for id := range byID {
		if seen[id] {
			continue
		}
		if err := s.FollowUps.Delete(ctx, id); err != nil {
			return err
		}
		summary.FollowUps++
	}
	return nil
}

// saveFollowUp writes a follow-up as its event says, over whatever is
// stored (she may have just marked it done).
func (s Syncer) saveFollowUp(ctx context.Context, event calendar.Event, aliases clients.Aliases) (followups.FollowUp, error) {
	for attempt := 0; ; attempt++ {
		before, _, err := s.FollowUps.Get(ctx, event.ID)
		if err != nil {
			return followups.FollowUp{}, err
		}
		saved, err := s.FollowUps.Save(ctx, followups.FromEvent(before, event, aliases, s.Location))
		if errors.Is(err, dynamo.ErrConflict) && attempt < 3 {
			continue
		}
		return saved, err
	}
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

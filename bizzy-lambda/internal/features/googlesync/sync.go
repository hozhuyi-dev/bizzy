// Package googlesync keeps bizzy and the user's Google account in step.
// bizzy is the truth; the calendar is another place to make changes, and
// every event in it is bizzy's.
//
// Reading (Run): every event changed since the last run is read as the
// actions the app would take (translate.go). Each event is one Runner
// call, so one event's changes commit together or not at all, and a
// refused one doesn't hold up the rest. A refused event is tried again
// after the others (one may have made room), and events refused only for
// where they'd end up among other sessions are tried together in one
// commit (two sessions swapped each land on the other's time). What is
// still refused waits as a conflict, tried again on every run.
//
// Writing (push.go): after every commit, the sessions and follow-ups it
// changed are written to their events, and the events of deleted ones
// removed. A write that fails is retried by the next run, which writes
// every item in its window whose event doesn't show it.
//
// Which event shows which item is this package's (Link): sessions and
// follow-ups know nothing of the calendar. The run also refreshes each
// client's copy of their Google contact (see contacts).
package googlesync

import (
	"context"
	"errors"
	"slices"
	"time"

	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// Window is how far back and ahead a run reads and writes the calendar.
const Window = 60 * 24 * time.Hour

// slack re-reads a little before the last run, in case Google's clock and
// ours disagree. Re-reading an event is harmless: one bizzy agrees with
// changes nothing.
const slack = time.Minute

type Sync struct {
	Runner *txn.Runner
	// Calendar opens the calendar the user chose; an error means none is
	// connected.
	Calendar func(ctx context.Context) (calendar.Calendar, error)
	// Contacts is the user's Google contacts; nil leaves the clients'
	// copies as they are.
	Contacts contacts.Directory
}

// State is what the sync remembers between runs.
type State struct {
	ID string `json:"id"`
	// ReadAt is when the last run read the calendar.
	ReadAt time.Time `json:"readAt"`
	// Last is what the last run did, or why it failed.
	Last *Run `json:"last,omitempty"`
}

// Run is what a run did.
type Run struct {
	At      time.Time `json:"at"`
	Read    int       `json:"read"`
	Refused int       `json:"refused"`
	Error   string    `json:"error,omitempty"`
}

var States = txn.Kind[State]{
	Name: "SYNC", Gone: "The calendar was never synced.",
	Doc:  txn.Doc{What: "What the sync remembers between runs: one item, CALENDAR."},
	Meta: func(s *State) txn.Meta { return txn.Meta{ID: s.ID} },
}

const stateID = "CALENDAR"

// Run reads the calendar's changes into bizzy, then writes bizzy's to it,
// and records how it went.
func (s *Sync) Run(ctx context.Context) (Run, error) {
	now := s.Runner.Now()
	run, err := s.run(ctx, now)
	run.At = now.UTC()
	if err != nil {
		run.Error = "The sync failed. Please try again."
		var shown *apperr.Error
		if errors.As(err, &shown) {
			run.Error = shown.Message
		}
	}
	_, saveErr := txn.Run(ctx, s.Runner.Quiet(), func(tx *txn.Tx) (any, error) {
		st, ok, err := States.Find(tx, stateID)
		switch {
		case err != nil:
			return nil, err
		case !ok:
			st = &State{ID: stateID}
			if err := States.Add(tx, st); err != nil {
				return nil, err
			}
		}
		if run.Error == "" {
			st.ReadAt = now
		}
		st.Last = &run
		return nil, nil
	})
	return run, errors.Join(err, saveErr)
}

func (s *Sync) run(ctx context.Context, now time.Time) (Run, error) {
	var run Run
	if err := s.refreshContacts(ctx); err != nil {
		return run, err
	}
	cal, err := s.Calendar(ctx)
	if err != nil {
		return run, err
	}
	since, err := txn.Read(ctx, s.Runner, func(tx *txn.Tx) (time.Time, error) {
		st, ok, err := States.Find(tx, stateID)
		if !ok || st.ReadAt.IsZero() {
			return time.Time{}, err
		}
		return st.ReadAt.Add(-slack), err
	})
	if err != nil {
		return run, err
	}
	events, err := cal.Changed(ctx, since, now.Add(-Window))
	if err != nil {
		return run, err
	}
	if events, err = s.withWaiting(ctx, cal, events); err != nil {
		return run, err
	}
	run.Read = len(events)

	// Apply each; try the refused ones again while any gets through.
	refused := map[string]error{}
	for pending := events; len(pending) > 0; {
		var again []calendar.Event
		for _, e := range pending {
			err := s.apply(ctx, e)
			switch {
			case err == nil:
				delete(refused, e.ID)
			case isRefusal(err):
				refused[e.ID] = err
				again = append(again, e)
			default:
				return run, err
			}
		}
		if len(again) == len(pending) {
			// Stuck: those refused for where they'd end up among the
			// others may fit together (a swap).
			if s.together(ctx, again, refused) {
				continue
			}
			break
		}
		pending = again
	}
	for _, e := range events {
		if err, ok := refused[e.ID]; ok {
			if err := s.hold(ctx, e, err); err != nil {
				return run, err
			}
		}
	}
	run.Refused = len(refused)
	return run, s.writeAll(ctx, cal, now)
}

// refreshContacts copies every linked client's Google contact, as Google
// has it now.
func (s *Sync) refreshContacts(ctx context.Context) error {
	if s.Contacts == nil {
		return nil
	}
	people, err := s.Contacts.List(ctx)
	if err != nil {
		return err
	}
	_, err = txn.Run(ctx, s.Runner, func(tx *txn.Tx) (any, error) { return nil, contacts.Refresh(tx, people, true) })
	return err
}

// withWaiting adds the events of edits waiting as conflicts, read again:
// what was refused may get through now.
func (s *Sync) withWaiting(ctx context.Context, cal calendar.Calendar, events []calendar.Event) ([]calendar.Event, error) {
	waiting, err := txn.Read(ctx, s.Runner, func(tx *txn.Tx) ([]*conflicts.Conflict, error) {
		return conflicts.Conflicts.All(tx)
	})
	if err != nil {
		return nil, err
	}
	for _, c := range waiting {
		if slices.ContainsFunc(events, func(e calendar.Event) bool { return e.ID == c.EventID }) {
			continue
		}
		e, err := read(ctx, cal, c.EventID)
		if err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, nil
}

// read reads one event as the sync does: one gone is cancelled.
func read(ctx context.Context, cal calendar.Calendar, id string) (calendar.Event, error) {
	e, err := cal.Get(ctx, id)
	if errors.Is(err, calendar.ErrGone) {
		return calendar.Event{ID: id, Cancelled: true}, nil
	}
	return e, err
}

// apply reads one event into bizzy, settling any conflict over it.
func (s *Sync) apply(ctx context.Context, e calendar.Event) error {
	_, err := txn.Run(ctx, s.Runner, func(tx *txn.Tx) (any, error) {
		if err := FromCalendar(tx, e); err != nil {
			return nil, err
		}
		return nil, conflicts.Conflicts.Delete(tx, e.ID)
	})
	return err
}

// together applies, in one commit, the events refused only for where they
// would end up among other sessions (see txn.Tx.Later); it reports whether
// they got through, clearing them from refused.
func (s *Sync) together(ctx context.Context, events []calendar.Event, refused map[string]error) bool {
	var group []calendar.Event
	for _, e := range events {
		var late *txn.LateError
		if errors.As(refused[e.ID], &late) {
			group = append(group, e)
		}
	}
	if len(group) < 2 {
		return false
	}
	_, err := txn.Run(ctx, s.Runner, func(tx *txn.Tx) (any, error) {
		for _, e := range group {
			if err := FromCalendar(tx, e); err != nil {
				return nil, err
			}
			if err := conflicts.Conflicts.Delete(tx, e.ID); err != nil {
				return nil, err
			}
		}
		return nil, nil
	})
	if err != nil {
		return false
	}
	for _, e := range group {
		delete(refused, e.ID)
	}
	return true
}

// hold keeps a refused event as a conflict on the to-do list, offering
// the refusal's remedies and putting bizzy's version back (for a new
// event, deleting it).
func (s *Sync) hold(ctx context.Context, e calendar.Event, refusal error) error {
	var shown *apperr.Error
	errors.As(refusal, &shown)
	_, err := txn.Run(ctx, s.Runner, func(tx *txn.Tx) (any, error) {
		c := conflicts.Conflict{
			EventID: e.ID, Shown: calendar.NotedSnapshotOf(e), Gone: e.Cancelled, Message: shown.Message,
			Remedies: slices.Clone(shown.Remedies), Since: tx.Now(),
		}
		label := "Delete the event"
		if l, ok, err := Links.Find(tx, e.ID); err != nil {
			return nil, err
		} else if ok && l.ItemID != "" {
			c.ItemKind, c.ItemID, label = string(l.Kind), l.ItemID, "Put bizzy's version back in the calendar"
			if e.Cancelled {
				label = "Put the event back"
			}
		}
		if !slices.ContainsFunc(c.Remedies, func(r apperr.Remedy) bool { return r.Action == "calendar.revert" }) {
			c.Remedies = append(c.Remedies, apperr.Remedy{Action: "calendar.revert", Target: e.ID, Label: label})
		}
		was, ok, err := conflicts.Conflicts.Find(tx, e.ID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, conflicts.Conflicts.Add(tx, &c)
		}
		c.Since = was.Since
		*was = c
		return nil, nil
	})
	return err
}

// isRefusal reports whether an event was refused, rather than failing.
func isRefusal(err error) bool {
	var shown *apperr.Error
	return errors.As(err, &shown) && shown.Code != apperr.CodeConflict && shown.Code != apperr.CodeDisconnected
}

// Revert puts bizzy's version back over the user's refused edit, which the
// commit's writing then does: an edited event is written over, and an
// event that shows nothing of bizzy's is deleted. A deleted event's item
// has no event left: Revert returns it, for the caller to write once this
// commits (as a new event; the next sync would too).
func Revert(tx *txn.Tx, eventID string) (ItemKind, string, error) {
	c, err := conflicts.Conflicts.Get(tx, eventID)
	if err != nil {
		return "", "", err
	}
	if err := conflicts.Conflicts.Delete(tx, eventID); err != nil {
		return "", "", err
	}
	l, ok, err := Links.Find(tx, eventID)
	switch {
	case err != nil:
		return "", "", err
	case !ok:
		// A link to nothing is an event to delete.
		return "", "", Links.Add(tx, &Link{EventID: eventID, Seen: c.Shown})
	case c.Gone:
		return l.Kind, l.ItemID, Links.Delete(tx, eventID)
	}
	// Taken as showing the edit, which then differs from what bizzy shows,
	// so it is written over. A session's description is the user's.
	l.Seen = c.Shown
	if l.Kind == KindSession {
		l.Seen.Description = nil
	}
	return "", "", nil
}

// Apply reads a waiting edit's event again, now, and applies it if
// nothing stands in its way any more; else it is refused with what still
// does.
func (s *Sync) Apply(ctx context.Context, eventID string) error {
	if _, err := txn.Read(ctx, s.Runner, func(tx *txn.Tx) (*conflicts.Conflict, error) {
		return conflicts.Conflicts.Get(tx, eventID)
	}); err != nil {
		return err
	}
	cal, err := s.Calendar(ctx)
	if err != nil {
		return err
	}
	e, err := read(ctx, cal, eventID)
	if err != nil {
		return err
	}
	if err := s.apply(ctx, e); err != nil {
		if isRefusal(err) {
			return errors.Join(err, s.hold(ctx, e, err))
		}
		return err
	}
	return nil
}

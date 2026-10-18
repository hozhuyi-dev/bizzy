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
// A calendar is first read from Window back; Backfill then reads it
// further back a month at a time, writing bizzy's items of each month
// that have no event, until nothing older is left. Choosing another
// calendar starts the sync over on it: bizzy forgets which events showed
// what, writes every item to the new calendar, and reads its events as
// it would any (bind). The calendar left is left as it is.
//
// Writing (push.go): after every commit, the sessions and follow-ups it
// changed are written to their events, and the events of deleted ones
// removed. A write that fails is retried by the next run, which writes
// every item from Window back whose event doesn't show it.
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
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
)

// Window is how far back a calendar is first read and written, and how
// far back every run writes what is still to write. Older events and
// items are the backfill's (Backfill).
const Window = 60 * 24 * time.Hour

// farFuture bounds "from now on".
var farFuture = time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)

// slack re-reads a little before the last run, in case Google's clock and
// ours disagree. Re-reading an event is harmless: one bizzy agrees with
// changes nothing.
const slack = time.Minute

// maxEmptyMonths bounds how many months with nothing in them one backfill
// step goes on through.
const maxEmptyMonths = 12

type Sync struct {
	Runner *txn.Runner
	// Calendar opens the calendar the user chose; an error means none is
	// connected, or chosen.
	Calendar func(ctx context.Context) (calendar.Calendar, error)
	// Contacts is the user's Google contacts; nil leaves the clients'
	// copies as they are.
	Contacts contacts.Directory
}

// State is what the sync remembers between runs.
type State struct {
	ID string `json:"id"`
	// CalendarID is the calendar the sync reads. Choosing another starts
	// the sync over on it (see bind); "" is state kept before this was.
	CalendarID string `json:"calendarId,omitempty"`
	// ReadAt is when the last run read the calendar; zero until the first
	// read of CalendarID is done.
	ReadAt time.Time `json:"readAt"`
	// Back is how far back the calendar is read and written. Floor is the
	// earliest event or item before it, which the backfill reads back to;
	// zero once it has.
	Back  time.Time `json:"back,omitzero"`
	Floor time.Time `json:"floor,omitzero"`
	// Last is what the last run did, or why it failed.
	Last *Run `json:"last,omitempty"`
}

// on reports whether the sync reads a calendar.
func (st *State) on(cal calendar.Calendar) bool {
	return st.CalendarID == cal.ID() || (st.CalendarID == "" && !st.ReadAt.IsZero())
}

// Run is what a run did.
type Run struct {
	At      time.Time `json:"at"`
	Read    int       `json:"read"`
	Refused int       `json:"refused"`
	Error   string    `json:"error,omitempty"`
	// Back is how far back the calendar is read, while older events are
	// still to read (Backfill).
	Back time.Time `json:"back,omitzero"`
}

var States = txn.Kind[State]{
	Name: "SYNC", Gone: "The calendar was never synced.",
	Doc:  txn.Doc{What: "What the sync remembers between runs: one item, CALENDAR."},
	Meta: func(s *State) txn.Meta { return txn.Meta{ID: s.ID} },
}

const stateID = "CALENDAR"

// errSyncFirst refuses what acts on the calendar between choosing another
// and the sync starting over on it: what bizzy knows of events is of the
// one before.
var errSyncFirst = apperr.Conflict("The calendar was just changed: sync first.")

// state is what the sync remembers; nil before the first run.
func (s *Sync) state(ctx context.Context) (*State, error) {
	return txn.Read(ctx, s.Runner, func(tx *txn.Tx) (*State, error) {
		st, _, err := States.Find(tx, stateID)
		return st, err
	})
}

// save changes what the sync remembers. Quiet: it shows in no event.
func (s *Sync) save(ctx context.Context, change func(st *State)) error {
	_, err := txn.Run(ctx, s.Runner.Quiet(), func(tx *txn.Tx) (any, error) {
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
		change(st)
		return nil, nil
	})
	return err
}

// current opens the chosen calendar, once the sync reads it.
func (s *Sync) current(ctx context.Context) (calendar.Calendar, error) {
	cal, err := s.Calendar(ctx)
	if err != nil {
		return nil, err
	}
	st, err := s.state(ctx)
	if err != nil {
		return nil, err
	}
	if st == nil || !st.on(cal) {
		return nil, errSyncFirst
	}
	return cal, nil
}

// Run reads the calendar's changes into bizzy, then writes bizzy's to it,
// and records how it went.
func (s *Sync) Run(ctx context.Context) (Run, error) {
	now := s.Runner.Now()
	run, pass, err := s.run(ctx, now)
	run.At = now.UTC()
	if err != nil {
		run.Error = "The sync failed. Please try again."
		var shown *apperr.Error
		if errors.As(err, &shown) {
			run.Error = shown.Message
		}
	}
	saveErr := s.save(ctx, func(st *State) {
		if run.Error == "" && st.CalendarID == pass.calendarID {
			st.ReadAt = now
			if st.Back.IsZero() {
				st.Back, st.Floor = pass.back, pass.floor
			}
		}
		run.Back = backOf(st)
		last := run
		st.Last = &last
	})
	return run, errors.Join(err, saveErr)
}

// backOf is how far back the calendar is read, while there is older.
func backOf(st *State) time.Time {
	if st.Floor.IsZero() {
		return time.Time{}
	}
	return st.Back
}

// pass is what a run read: which calendar, and the first time, how far
// back and when the earliest of what is older is.
type pass struct {
	calendarID  string
	back, floor time.Time
}

func (s *Sync) run(ctx context.Context, now time.Time) (Run, pass, error) {
	var run Run
	var r pass
	if err := s.refreshContacts(ctx); err != nil {
		return run, r, err
	}
	cal, err := s.Calendar(ctx)
	if err != nil {
		return run, r, err
	}
	st, err := s.bind(ctx, cal)
	if err != nil {
		return run, r, err
	}
	r.calendarID = st.CalendarID

	// The first read is of every event from Window back; then of what
	// changed, however old.
	since, from := st.ReadAt.Add(-slack), time.Time{}
	if st.ReadAt.IsZero() {
		since, from = time.Time{}, now.Add(-Window)
	}
	events, err := cal.Changed(ctx, since, from, time.Time{})
	if err != nil {
		return run, r, err
	}
	if events, err = s.withWaiting(ctx, cal, events); err != nil {
		return run, r, err
	}
	run.Read = len(events)
	if run.Refused, err = s.applyAll(ctx, events); err != nil {
		return run, r, err
	}
	if _, err := s.writeAll(ctx, cal, now.Add(-Window), farFuture); err != nil {
		return run, r, err
	}
	if st.Back.IsZero() {
		r.back = now.Add(-Window)
		r.floor, err = s.floor(ctx, cal, r.back)
	}
	return run, r, err
}

// bind makes the sync's state the chosen calendar's. On another than the
// one it read, the sync starts over: it forgets the events of the one
// before, and its next read is a first one.
func (s *Sync) bind(ctx context.Context, cal calendar.Calendar) (State, error) {
	st, err := s.state(ctx)
	switch {
	case err != nil:
		return State{}, err
	case st != nil && st.CalendarID == cal.ID():
		return *st, nil
	case st != nil && st.on(cal):
		// Kept before the calendar was: it is the one chosen.
		st.CalendarID = cal.ID()
		return *st, s.save(ctx, func(st *State) { st.CalendarID = cal.ID() })
	}
	if err := s.forget(ctx); err != nil {
		return State{}, err
	}
	return State{ID: stateID, CalendarID: cal.ID()},
		s.save(ctx, func(st *State) { *st = State{ID: stateID, CalendarID: cal.ID(), Last: st.Last} })
}

// forget deletes what bizzy knows of the events of the calendar it read
// before: which shows which item, and the edits waiting. The items stay,
// to be written to the one chosen now. A run cut short forgets the rest
// the next time.
func (s *Sync) forget(ctx context.Context) error {
	type known struct{ links, waiting []string }
	k, err := txn.Read(ctx, s.Runner, func(tx *txn.Tx) (known, error) {
		var k known
		var err error
		if k.links, err = Links.IDs(tx); err != nil {
			return k, err
		}
		k.waiting, err = conflicts.Conflicts.IDs(tx)
		return k, err
	})
	if err != nil {
		return err
	}
	if err := s.deleteAll(ctx, k.waiting, conflicts.Conflicts.Delete); err != nil {
		return err
	}
	return s.deleteAll(ctx, k.links, Links.Delete)
}

// deleteAll deletes items, as many to a commit as one takes.
func (s *Sync) deleteAll(ctx context.Context, ids []string, del func(tx *txn.Tx, id string) error) error {
	for batch := range slices.Chunk(ids, table.MaxWrites) {
		if _, err := txn.Run(ctx, s.Runner.Quiet(), func(tx *txn.Tx) (any, error) {
			for _, id := range batch {
				if err := del(tx, id); err != nil {
					return nil, err
				}
			}
			return nil, nil
		}); err != nil {
			return err
		}
	}
	return nil
}

// floor is when the earliest event or item before a time is; zero when
// there is none.
func (s *Sync) floor(ctx context.Context, cal calendar.Calendar, before time.Time) (time.Time, error) {
	first, ok, err := cal.Earliest(ctx, before)
	if err != nil {
		return time.Time{}, err
	}
	if !ok {
		first = time.Time{}
	}
	return txn.Read(ctx, s.Runner, func(tx *txn.Tx) (time.Time, error) {
		earliest := first
		earlier := func(at time.Time) {
			if at.Before(before) && (earliest.IsZero() || at.Before(earliest)) {
				earliest = at
			}
		}
		ss, err := sessions.Sessions.Between(tx, time.Time{}, before)
		if err != nil {
			return time.Time{}, err
		}
		if len(ss) > 0 {
			earlier(ss[0].Start)
		}
		fs, err := followups.FollowUps.Between(tx, time.Time{}, before)
		if err != nil {
			return time.Time{}, err
		}
		if len(fs) > 0 {
			earlier(fs[0].Due)
		}
		return earliest, nil
	})
}

// Backfill reads and writes the month before how far back the calendar is
// read, and on through any months with nothing in them. Called until its
// Back is zero, it reads the whole calendar.
func (s *Sync) Backfill(ctx context.Context) (Run, error) {
	run := Run{At: s.Runner.Now().UTC()}
	cal, err := s.current(ctx)
	if err != nil {
		return run, err
	}
	st, err := s.state(ctx)
	switch {
	case err != nil:
		return run, err
	case st.ReadAt.IsZero():
		return run, errSyncFirst
	case st.Floor.IsZero():
		return run, nil
	}
	to := st.Back
	for months := 0; to.After(st.Floor) && months < maxEmptyMonths; months++ {
		from := to.AddDate(0, -1, 0)
		events, err := cal.Changed(ctx, time.Time{}, from, to)
		if err != nil {
			return run, err
		}
		refused, err := s.applyAll(ctx, events)
		if err != nil {
			return run, err
		}
		items, err := s.writeAll(ctx, cal, from, to)
		if err != nil {
			return run, err
		}
		run.Read, run.Refused, to = run.Read+len(events), run.Refused+refused, from
		if len(events) > 0 || items > 0 {
			break
		}
	}
	return run, s.save(ctx, func(now *State) {
		// Unless the sync started over meanwhile, or another backfill went
		// first.
		if now.CalendarID == st.CalendarID && now.Back.Equal(st.Back) {
			now.Back = to
			if !to.After(now.Floor) {
				now.Floor = time.Time{}
			}
		}
		run.Back = backOf(now)
	})
}

// applyAll reads events into bizzy, trying the refused ones again while
// any gets through; those still refused wait as conflicts. It returns how
// many wait.
func (s *Sync) applyAll(ctx context.Context, events []calendar.Event) (int, error) {
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
				return 0, err
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
				return 0, err
			}
		}
	}
	return len(refused), nil
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
	cal, err := s.current(ctx)
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

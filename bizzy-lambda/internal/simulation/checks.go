package simulation

import (
	"context"
	"maps"
	"slices"
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/app"
	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/txn"
)

// check runs after every action. Refused actions are checked as they
// happen (World.call), views against the API around the actions they
// offer (World.callAsViewed), and the app bringing on conflicts around
// each user action (simulation_test.go).
func check(t *rapid.T, w *World) {
	t.Helper()
	invariantsHold(t, w)
	filesAreThere(t, w)
	if w.InSync {
		calendarShowsBizzy(t, w)
	}
}

// invariantsHold: every feature's invariants, over everything stored.
func invariantsHold(t *rapid.T, w *World) {
	t.Helper()
	broken, err := txn.CheckAll(context.Background(), w.Runner, app.Kinds()...)
	if err != nil {
		t.Fatalf("checking invariants: %v", err)
	}
	if len(broken) > 0 {
		t.Fatalf("invariants broken: %v", broken)
	}
}

// filesAreThere: every attachment's file is in the file store, kept (not
// pending): the table is written before a file is deleted, never after.
func filesAreThere(t *rapid.T, w *World) {
	t.Helper()
	for _, a := range read(t, w, attachments.Attachments.All) {
		if blob, ok := w.Blobs.Blobs[a.Key]; !ok || blob.Pending {
			t.Fatalf("attachment %s's file %s isn't kept", a.ID, a.Key)
		}
	}
}

// calendarShowsBizzy: once synced, within the sync's window, every
// session's and follow-up's event shows it, unless the user's edit of it
// waits as a conflict; every event in the calendar shows one, or waits:
// all of them are bizzy's; and no deleted item's event is left.
func calendarShowsBizzy(t *rapid.T, w *World) {
	t.Helper()
	from, to := w.Now.Add(-googlesync.Window), w.Now.Add(googlesync.Window)
	in := func(at time.Time) bool { return !at.Before(from) && !at.After(to) }
	live := map[string]calendar.Event{}
	for _, e := range w.Calendar.Live {
		live[e.ID] = e
	}
	type shown struct {
		kind googlesync.ItemKind
		id   string
		want calendar.Snapshot
		link *googlesync.Link
	}
	all := read(t, w, func(tx *txn.Tx) ([]shown, error) {
		var out []shown
		add := func(kind googlesync.ItemKind, id string) error {
			l, err := googlesync.LinkOf(tx, kind, id)
			if err != nil {
				return err
			}
			var seen *calendar.Snapshot
			if l != nil {
				seen = &l.Seen
			}
			want, err := googlesync.EventOf(tx, kind, id, seen)
			out = append(out, shown{kind, id, want, l})
			return err
		}
		ss, err := sessions.Sessions.Between(tx, from, to)
		if err != nil {
			return nil, err
		}
		for _, s := range ss {
			if err := add(googlesync.KindSession, s.ID); err != nil {
				return nil, err
			}
		}
		fs, err := followups.FollowUps.Between(tx, from, to)
		if err != nil {
			return nil, err
		}
		for _, f := range fs {
			if err := add(googlesync.KindFollowUp, f.ID); err != nil {
				return nil, err
			}
		}
		return out, nil
	})
	waiting := conflictIDs(t, w)
	for _, x := range all {
		if x.link == nil {
			t.Fatalf("%s %s has no event after a sync", x.kind, x.id)
		}
		if waiting[x.link.EventID] {
			continue
		}
		e, ok := live[x.link.EventID]
		switch {
		case !ok:
			t.Fatalf("%s %s's event %s isn't in the calendar", x.kind, x.id, x.link.EventID)
		case !shownAs(x.kind, e).Same(x.link.Seen):
			t.Fatalf("%s %s's event says %+v, not %+v as last agreed", x.kind, x.id, shownAs(x.kind, e), x.link.Seen)
		case !x.want.Same(x.link.Seen):
			t.Fatalf("%s %s's event says %+v, but it is %+v", x.kind, x.id, x.link.Seen, x.want)
		}
	}
	for _, id := range slices.Sorted(maps.Keys(live)) {
		e := live[id]
		if !in(e.At()) || waiting[id] {
			continue
		}
		l := read(t, w, func(tx *txn.Tx) (*googlesync.Link, error) {
			l, ok, err := googlesync.Links.Find(tx, id)
			if !ok {
				return nil, err
			}
			return l, err
		})
		if l == nil || l.ItemID == "" {
			t.Fatalf("event %s %q shows nothing, and waits for nothing", id, e.Title)
		}
	}
}

func shownAs(kind googlesync.ItemKind, e calendar.Event) calendar.Snapshot {
	if kind == googlesync.KindFollowUp {
		return calendar.NotedSnapshotOf(e)
	}
	return calendar.SnapshotOf(e)
}

// noNewConflicts: the app refuses what isn't allowed before anything is
// written, so only the calendar, edited directly, can bring on a conflict.
func noNewConflicts(t *rapid.T, action string, before, after map[string]bool) {
	t.Helper()
	for id := range after {
		if !before[id] {
			t.Fatalf("%s in the app brought on a conflict over event %s", action, id)
		}
	}
}

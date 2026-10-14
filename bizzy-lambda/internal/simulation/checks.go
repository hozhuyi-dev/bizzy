package simulation

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"slices"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/features/book"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/integrity"
	"bizzy-lambda/internal/testutil/memory"
)

// check runs after every action. Refused actions are checked as they
// happen (World.Call).
func check(t *rapid.T, w *World) {
	t.Helper()
	if w.unhealed {
		// A request died partway: the stores may be half changed until the
		// next sync repairs them, and are checked then.
		return
	}
	noImpossibleStates(t, w)
	everyPackageToDoIsListed(t, w)
	if w.InSync {
		derivedFieldsAreCurrent(t, w)
		calendarMirrorsBizzy(t, w)
	}
}

// everyPackageToDoIsListed: a package with something to do is on the to-do
// list the app shows, which reads the open index (packages.Package.Open),
// not every package.
func everyPackageToDoIsListed(t *rapid.T, w *World) {
	t.Helper()
	listed := map[string]bool{}
	open, err := w.Store.Packages().ListOpen(context.Background())
	if err != nil {
		t.Fatalf("list open packages: %v", err)
	}
	for _, p := range open {
		listed[p.ID] = true
	}
	for _, id := range slices.Sorted(maps.Keys(w.Store.PackageMap)) {
		if p := w.Store.PackageMap[id]; len(p.Todo(w.Now)) > 0 && !listed[id] {
			t.Fatalf("package %s has %v to do, but the to-do list doesn't show it", id, p.Todo(w.Now))
		}
	}
}

// world is everything stored, as integrity checks it.
func (w *World) world() integrity.World {
	world := integrity.World{
		Settings: w.Store.SettingsVal.WithDefaults(), Clients: w.Store.ClientMap,
		Sessions: w.Store.SessionMap, Packages: w.Store.PackageMap, FollowUps: w.Store.FollowUpMap,
		Documents: w.Store.Docs, Revisions: w.Store.Revs, Shares: w.Store.SharesMap,
		Conflicts: w.Store.ConflictMap, Externals: w.Store.ExternalMap,
		Attachments: w.Store.AttachmentMap, Files: map[string]bool{},
		Expenses: w.Store.ExpenseMap, Items: w.Store.ItemMap, Categories: w.Store.CategoryList,
		Location: kl, Now: w.Now,
	}
	for key, blob := range w.Blobs.Blobs {
		world.Files[key] = !blob.Pending
	}
	return world
}

// noImpossibleStates: no entity is in a state its rule table calls
// impossible, the book's invariants hold, and so do the links between
// entities (see internal/integrity).
func noImpossibleStates(t *rapid.T, w *World) {
	t.Helper()
	var broken []integrity.Violation
	for _, v := range integrity.Check(w.world()) {
		if v.Pending == "" && v.Tolerated == "" {
			broken = append(broken, v)
		} else if !w.pendingSeen[v.Rule] {
			w.pendingSeen[v.Rule] = true
			t.Logf("known gap or tolerated break reached (%s): %s", v.Rule, v.Detail)
		}
	}
	if len(broken) > 0 {
		t.Fatalf("impossible state: %v", broken)
	}
}

// derivedFieldsAreCurrent: while nothing changed outside since the last
// sync, a sync and a re-derivation of every client find nothing to write.
// Every action applies its change completely: what items copy is never
// stale, and the calendar shows it.
func derivedFieldsAreCurrent(t *rapid.T, w *World) {
	t.Helper()
	ctx := context.Background()
	f := w.fork(t)
	if _, err := f.App.Sync(ctx, googlesync.Range{}); err != nil {
		t.Fatalf("sync: %v", err)
	}
	if diff := changes(w.Store, f.Store); len(diff) > 0 {
		t.Fatalf("a sync right after the last one changed %v", diff)
	}
	if err := f.App.RederiveAll(ctx); err != nil {
		t.Fatalf("rederive: %v", err)
	}
	if diff := changes(w.Store, f.Store); len(diff) > 0 {
		t.Fatalf("re-deriving every client changed %v", diff)
	}
}

// calendarMirrorsBizzy: once synced, every session's and follow-up's event
// shows it as it is (its projection), unless she has an edit there waiting
// as a conflict; and every session or follow-up event in the calendar shows
// one, waits as a conflict, or was said not to be bizzy's.
func calendarMirrorsBizzy(t *rapid.T, w *World) {
	t.Helper()
	ctx := context.Background()
	live := map[string]calendar.Event{}
	for _, e := range w.Calendar.Live {
		live[e.ID] = e
	}
	books := map[string]*book.Book{}
	bookOf := func(clientID string) *book.Book {
		b, ok := books[clientID]
		if !ok {
			var err error
			if b, err = w.App.Book.Load(ctx, book.Scope{Clients: []string{clientID}}); err != nil {
				t.Fatalf("load: %v", err)
			}
			books[clientID] = b
		}
		return b
	}
	mirrors := func(what string, link calendar.Link, snapshot func(calendar.Event) calendar.Snapshot, want func() calendar.Snapshot) {
		if _, waiting := w.Store.ConflictMap[conflicts.Key(conflicts.SurfaceCalendar, link.EventID)]; waiting {
			return
		}
		e, ok := live[link.EventID]
		switch {
		case link.EventID == "" || link.Pending:
			t.Fatalf("%s's event is still to be written after a sync: %+v", what, link)
		case !ok:
			t.Fatalf("%s's event %s isn't in the calendar", what, link.EventID)
		case !snapshot(e).Same(*link.Seen):
			t.Fatalf("%s's event says %+v, not %+v as last agreed", what, snapshot(e), *link.Seen)
		case !want().Same(*link.Seen):
			t.Fatalf("%s's event says %+v, but it is %+v", what, *link.Seen, want())
		}
	}
	for _, id := range slices.Sorted(maps.Keys(w.Store.SessionMap)) {
		s := w.Store.SessionMap[id]
		mirrors("session "+id, s.Event, calendar.SnapshotOf, func() calendar.Snapshot {
			b := bookOf(s.ClientID)
			return b.Projection(b.Sessions[id])
		})
	}
	for _, id := range slices.Sorted(maps.Keys(w.Store.FollowUpMap)) {
		f := w.Store.FollowUpMap[id]
		mirrors("follow-up "+id, f.Event, calendar.NotedSnapshotOf, func() calendar.Snapshot {
			b := bookOf(f.ClientID)
			return b.FollowUpProjection(b.FollowUps[id])
		})
	}
	for _, e := range w.Calendar.Live {
		if e.AllDay && !calendar.IsFollowUp(e.Title) {
			continue
		}
		key := conflicts.Key(conflicts.SurfaceCalendar, e.ID)
		if _, shown := w.Store.ExternalMap[key]; shown {
			continue
		}
		if _, waiting := w.Store.ConflictMap[key]; !waiting {
			t.Fatalf("event %s %q shows nothing, and waits for nothing", e.ID, e.Title)
		}
	}
}

// contradictions are what needs fixing because of something outside the
// app: each conflict, keyed "conflict <key>".
func (w *World) contradictions() map[string][]string {
	out := map[string][]string{}
	for key, c := range w.Store.ConflictMap {
		guards := []string{}
		for _, v := range c.Violations {
			guards = append(guards, v.Guard)
		}
		out["conflict "+key] = guards
	}
	return out
}

// noNewContradictions: in the app, the user brings on nothing to fix: the
// app refuses what isn't allowed, so only the calendar and Google Contacts
// changing underneath can. Checked while nothing outside waits to be
// synced, which could bring on a conflict of its own during the action.
func noNewContradictions(t *rapid.T, action string, before, after map[string][]string) {
	t.Helper()
	var brought []string
	for _, key := range slices.Sorted(maps.Keys(after)) {
		if _, had := before[key]; !had {
			brought = append(brought, fmt.Sprintf("%s: %v", key, after[key]))
		}
	}
	if len(brought) > 0 {
		t.Fatalf("%s brought on what the user must now fix: %v", action, brought)
	}
}

// changes lists what differs between two stores, by item.
func changes(before, after *memory.Store) []string {
	var out []string
	diff := func(kind string, a, b map[string][]byte) {
		for _, id := range slices.Sorted(maps.Keys(b)) {
			if string(a[id]) != string(b[id]) {
				out = append(out, kind+" "+id+": "+string(a[id])+" → "+string(b[id]))
			}
		}
		for _, id := range slices.Sorted(maps.Keys(a)) {
			if _, ok := b[id]; !ok {
				out = append(out, kind+" "+id+" deleted")
			}
		}
	}
	diff("session", jsonEach(before.SessionMap), jsonEach(after.SessionMap))
	diff("follow-up", jsonEach(before.FollowUpMap), jsonEach(after.FollowUpMap))
	diff("package", jsonEach(before.PackageMap), jsonEach(after.PackageMap))
	diff("document", jsonEach(before.Docs), jsonEach(after.Docs))
	diff("client", jsonEach(before.ClientMap), jsonEach(after.ClientMap))
	diff("conflict", jsonEach(before.ConflictMap), jsonEach(after.ConflictMap))
	diff("external", jsonEach(before.ExternalMap), jsonEach(after.ExternalMap))
	diff("attachment", jsonEach(before.AttachmentMap), jsonEach(after.AttachmentMap))
	return out
}

func jsonEach[V any](items map[string]V) map[string][]byte {
	out := make(map[string][]byte, len(items))
	for id, v := range items {
		out[id], _ = json.Marshal(v)
	}
	return out
}

func toJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

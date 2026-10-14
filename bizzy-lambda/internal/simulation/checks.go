package simulation

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strings"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/features/billing"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/integrity"
	"bizzy-lambda/internal/platform/statemodel"
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

// noImpossibleStates: no entity is in a state its rule table calls
// impossible, and the links between them hold (see internal/integrity).
func noImpossibleStates(t *rapid.T, w *World) {
	t.Helper()
	world := integrity.World{
		Clients: w.Store.ClientMap, Sessions: w.Store.SessionMap, Packages: w.Store.PackageMap,
		FollowUps: w.Store.FollowUpMap, Documents: w.Docs.Docs, Revisions: w.Docs.Revs, Shares: w.Docs.SharesMap,
		Attachments: w.Store.AttachmentMap, Files: map[string]bool{},
		Expenses: w.Store.ExpenseMap, Items: w.Store.ItemMap, Categories: w.Store.CategoryList,
		Now: w.Now,
	}
	for key, blob := range w.Blobs.Blobs {
		world.Files[key] = !blob.Pending
	}
	var broken []integrity.Violation
	for _, v := range integrity.Check(world) {
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
// sync, a sync and a full reconcile find nothing to write. Every action in
// the app applies its change exactly as the next sync would, so what the
// reconcile derives (statuses, fees, credits, drift, activity) is never
// stale.
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
	if _, err := f.App.Reconciler.Reconcile(ctx, fullReconcile); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if diff := changes(w.Store, f.Store); len(diff) > 0 {
		t.Fatalf("a full reconcile changed %v", diff)
	}
}

// contradictions are the Contradiction rules that hold for each session,
// package and follow-up, keyed "<kind> <id>", whether or not a Stop rule
// hides them from the to-do list.
func (w *World) contradictions() map[string][]string {
	out := map[string][]string{}
	for id, s := range w.Store.SessionMap {
		out["session "+id] = billing.SessionContradictions(s, w.Now)
	}
	for id, p := range w.Store.PackageMap {
		out["package "+id] = billing.PackageContradictions(p, w.Now)
	}
	for id, f := range w.Store.FollowUpMap {
		out["follow-up "+id] = holding(followups.Rules, f.State())
	}
	return out
}

func holding[S any](rules statemodel.Rules[S], s S) []string {
	var ids []string
	for _, r := range rules {
		if r.Bucket == statemodel.Contradiction && r.When(s) {
			ids = append(ids, r.ID)
		}
	}
	return ids
}

// settled are the contradictions once whatever changed outside is synced:
// as they are while nothing waits to be, else those of a copy of the world
// that syncs. Comparing these before and after a user action leaves out
// what the calendar and Google Contacts bring on meanwhile. stale are the
// sessions, packages and follow-ups that sync would change (or add, or
// remove): what she and the forms' previews could not see as it will be.
func (w *World) settled(t *rapid.T) (contradictions map[string][]string, stale map[string]bool) {
	t.Helper()
	if w.InSync && !w.unhealed {
		return w.contradictions(), nil
	}
	f := w.fork(t)
	if _, err := f.App.Sync(context.Background(), googlesync.Range{}); err != nil {
		t.Fatalf("sync of a copy: %v", err)
	}
	stale = map[string]bool{}
	mark := func(kind string, before, after map[string][]byte) {
		for id := range before {
			if string(before[id]) != string(after[id]) {
				stale[kind+" "+id] = true
			}
		}
		for id := range after {
			if _, ok := before[id]; !ok {
				stale[kind+" "+id] = true
			}
		}
	}
	mark("session", jsonEach(w.Store.SessionMap), jsonEach(f.Store.SessionMap))
	mark("package", jsonEach(w.Store.PackageMap), jsonEach(f.Store.PackageMap))
	mark("follow-up", jsonEach(w.Store.FollowUpMap), jsonEach(f.Store.FollowUpMap))
	// What a session's title buys is as stale as the session.
	for key := range stale {
		if id, ok := strings.CutPrefix(key, "session "); ok {
			stale["package "+id] = true
		}
	}
	return f.contradictions(), stale
}

// noNewContradictions: in the app, the user brings on nothing to fix that
// the form didn't show her first: only the calendar and Google Contacts
// changing underneath do (see statemodel.Contradiction). A form's preview
// lists what saving would bring on (billing.Impact), and what she confirmed
// is allowed; anything else is a bug. With exact (nothing outside could
// interfere), so is a preview listing what didn't then happen. As
// billing.Brings has it, something already needing a fix that needs a
// different one isn't new work; nor is what the pending sync changes
// (stale), which she acted on unseen.
func noNewContradictions(t *rapid.T, action string, before, after map[string][]string, allowed []billing.Brought, exact bool, stale map[string]bool) {
	t.Helper()
	var brought []string
	matched := make([]bool, len(allowed))
	for _, key := range slices.Sorted(maps.Keys(after)) {
		if len(before[key]) > 0 {
			continue
		}
		kind, id, _ := strings.Cut(key, " ")
		_, existed := before[key]
		if stale[key] || (!existed && !exact) {
			// The calendar's changes still waiting to be synced change it,
			// or it is new beside them (a booking whose credit an unsynced
			// event takes first), which neither she nor the preview could
			// see: those changes, not her, decide it.
			continue
		}
		for _, rule := range after[key] {
			i := slices.IndexFunc(allowed, func(b billing.Brought) bool {
				return b.Kind == kind && b.Rule == rule && (b.ID == id || (b.ID == "new" && !existed))
			})
			if i < 0 {
				was := "absent"
				if existed {
					was = "quiet"
				}
				brought = append(brought, fmt.Sprintf("%s: %s (was %s)", key, rule, was))
				continue
			}
			matched[i] = true
		}
	}
	if len(brought) > 0 {
		t.Fatalf("%s brought on what the user must now fix, unshown: %v", action, brought)
	}
	if !exact {
		return
	}
	for i, b := range allowed {
		if !matched[i] {
			t.Fatalf("%s: the preview listed %s %s: %s, which it didn't bring on", action, b.Kind, b.ID, b.Rule)
		}
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
	diff("client", jsonEach(before.ClientMap), jsonEach(after.ClientMap))
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

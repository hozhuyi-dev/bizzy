package simulation

import (
	"context"
	"encoding/json"
	"maps"
	"slices"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/integrity"
	"bizzy-lambda/internal/testutil/memory"
)

// check runs after every action. Refused actions are checked as they
// happen (World.Call).
func check(t *rapid.T, w *World) {
	t.Helper()
	noImpossibleStates(t, w)
	if w.InSync {
		derivedFieldsAreCurrent(t, w)
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
		if v.Pending == "" {
			broken = append(broken, v)
		} else if !w.pendingSeen[v.Rule] {
			w.pendingSeen[v.Rule] = true
			t.Logf("known gap reached (%s): %s", v.Rule, v.Detail)
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
	m, a := w.clone(t)
	ctx := context.Background()
	if _, err := a.Sync(ctx, googlesync.Range{}); err != nil {
		t.Fatalf("sync: %v", err)
	}
	if diff := changes(w.Store, m); len(diff) > 0 {
		t.Fatalf("a sync right after the last one changed %v", diff)
	}
	if _, err := a.Reconciler.Reconcile(ctx, fullReconcile); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if diff := changes(w.Store, m); len(diff) > 0 {
		t.Fatalf("a full reconcile changed %v", diff)
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

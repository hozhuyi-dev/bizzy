// Package simulation drives the whole backend in random order, the way the
// app and the outside world do, and checks after every step that the state
// still makes sense.
//
// The world is the real app (internal/app) on the memory table, fakes of
// Google Calendar, Google Contacts and S3, and a clock (testutil/testapp).
// Actions come from actors (actions_*.go): the user calling the router
// with JSON as the app does, the user editing the calendar directly, and
// time passing. The checks (checks.go) are every feature's invariants over
// everything stored, that a refused action changes nothing, that a view's
// verdicts are what the API does, that the app never brings on a
// conflict, and that once synced the calendar shows bizzy as it is.
//
// A new feature adds an action per router mutation (a test enforces it),
// its invariants (through app.Invariants), and any check of its own.
//
// Run it longer to search deeper:
//
//	go test ./internal/simulation -rapid.checks=1000 -rapid.steps=300
package simulation

import (
	"bytes"
	"context"
	"encoding/json"
	"slices"
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
	"bizzy-lambda/internal/testutil/testapp"
)

type World struct {
	*testapp.App
	// InSync is true while nothing changed outside the app since the last
	// sync: the calendar must then show bizzy as it is.
	InSync bool
}

// seedClients are the practice's clients, with their usual fees.
var seedClients = []struct {
	name   string
	cents  int64
	visits bool
}{
	{"Jane Smith", 9000, false}, {"Bob Lee", 0, false}, {"Amy Tan", 12000, true},
}

var seedEvents = []struct {
	hours int
	title string
}{
	{-30, "Jane Smith"}, {-3, "Amy Tan 95"}, {2, "? Bob Lee 120"}, {26, "jane smith 10x85"}, {28, "Zed Ong"},
}

func newWorld(t *rapid.T) *World {
	w := &World{App: testapp.New()}
	for _, c := range seedClients {
		fields := map[string]any{"homeVisits": c.visits}
		if c.cents > 0 {
			fields["feeRates"] = []map[string]any{{"cents": c.cents}}
		}
		if _, err := w.Client(c.name, fields); err != nil {
			t.Fatalf("seed %s: %v", c.name, err)
		}
	}
	for _, e := range seedEvents {
		start := w.Now.Add(time.Duration(e.hours) * time.Hour)
		w.Calendar.UserAdd(e.title, start, start.Add(time.Hour))
	}
	w.call(t, "sync.run", nil)
	w.InSync = true
	return w
}

// call sends an action as the app does, and returns its result or its
// refusal. A failure the app would show as "Something went wrong" fails
// the run: each one is a bug. So does a refusal that changed anything.
func (w *World) call(t *rapid.T, action string, payload any) (json.RawMessage, *router.ErrorBody) {
	t.Helper()
	return w.send(t, action, payload, false)
}

// callRefreshing is call for an action that re-reads the calendar: even
// refused, it records what the event says now.
func (w *World) callRefreshing(t *rapid.T, action string, payload any) (json.RawMessage, *router.ErrorBody) {
	t.Helper()
	return w.send(t, action, payload, true)
}

func (w *World) send(t *rapid.T, action string, payload any, refreshes bool) (json.RawMessage, *router.ErrorBody) {
	t.Helper()
	before := w.dump()
	data, refused, err := w.Call(action, payload)
	body, _ := json.Marshal(payload)
	if err != nil {
		t.Fatalf("%s %s: %v", action, body, err)
	}
	if refused != nil {
		t.Logf("%s %s → refused (%s): %s", action, body, refused.Code, refused.Message)
		if after := w.dump(); !refreshes && !bytes.Equal(before, after) {
			t.Fatalf("%s was refused but changed something:\n%s", action, firstDiff(before, after))
		}
		return nil, refused
	}
	t.Logf("%s %s → ok", action, body)
	return data, nil
}

// callAsViewed calls an action whose view said whether it would be taken:
// the API must agree, refusing with the same message.
func (w *World) callAsViewed(t *rapid.T, action string, payload any, viewed apperr.Verdict) {
	t.Helper()
	_, refused := w.call(t, action, payload)
	switch {
	case viewed.OK && refused != nil && refused.Code == apperr.CodeRefused:
		t.Fatalf("%s: the view said yes, the API said %q", action, refused.Message)
	case !viewed.OK && refused == nil:
		t.Fatalf("%s: the view said %q, the API took it", action, viewed.Why)
	}
}

// dump is everything stored, in the calendar and in the file store.
func (w *World) dump() []byte {
	cal, _ := json.Marshal(w.Calendar)
	files, _ := json.Marshal(w.Blobs.Blobs)
	people, _ := json.Marshal(w.Contacts.People)
	return slices.Concat(w.Table.Dump(), cal, files, people)
}

// read reads the world as the app would.
func read[T any](t *rapid.T, w *World, fn func(tx *txn.Tx) (T, error)) T {
	t.Helper()
	out, err := txn.Read(context.Background(), w.Runner, fn)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	return out
}

// pick draws one of the items a kind lists, or skips the step when there
// are none.
func pick[T any](t *rapid.T, w *World, label string, list func(tx *txn.Tx) ([]*T, error)) *T {
	t.Helper()
	all := read(t, w, list)
	if len(all) == 0 {
		t.Skip("no " + label)
	}
	return rapid.SampledFrom(all).Draw(t, label)
}

// firstDiff shows where two dumps first differ.
func firstDiff(a, b []byte) string {
	i := 0
	for i < len(a) && i < len(b) && a[i] == b[i] {
		i++
	}
	from := max(i-200, 0)
	return "before: " + string(a[from:min(i+200, len(a))]) + "\nafter:  " + string(b[from:min(i+200, len(b))])
}

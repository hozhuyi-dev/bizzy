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
// verdicts and locks are what the API does, that the app never brings on a
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
	"reflect"
	"strings"
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
	"bizzy-lambda/internal/testutil/fakecal"
	"bizzy-lambda/internal/testutil/testapp"
)

type World struct {
	*testapp.App
	// Other is the calendar not chosen, which the user may choose instead
	// (calendar.switch).
	Other *fakecal.Calendar
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
	// Older than the first read, for the backfill.
	{-90 * 24, "Jane Smith"}, {-400 * 24, "Bob Lee 120"},
}

func newWorld(t *rapid.T) *World {
	w := &World{App: testapp.New()}
	w.Other = &fakecal.Calendar{Name: "clinic", Now: func() time.Time { return w.Now }}
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
	before := w.dump(t)
	data, refused, err := w.Call(action, payload)
	body, _ := json.Marshal(payload)
	if err != nil {
		t.Fatalf("%s %s: %v", action, body, err)
	}
	if refused != nil {
		t.Logf("%s %s → refused (%s): %s", action, body, refused.Code, refused.Message)
		if after := w.dump(t); !refreshes && !bytes.Equal(before, after) {
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

// callRefusedAsViewed calls an action whose view said whether what it
// acts on allows it, where what the request adds (another draft to move
// lines to) may still be refused: a view that said no must be refused.
func (w *World) callRefusedAsViewed(t *rapid.T, action string, payload any, viewed apperr.Verdict) {
	t.Helper()
	if _, refused := w.call(t, action, payload); !viewed.OK && refused == nil {
		t.Fatalf("%s: the view said %q, the API took it", action, viewed.Why)
	}
}

// viewOf reads an item's view as the app does, through a router query.
func viewOf[T any](t *rapid.T, w *World, query string, id string) T {
	t.Helper()
	var v T
	data, refused := w.call(t, query, map[string]any{"id": id})
	if refused != nil {
		t.Fatalf("%s %s: %s", query, id, refused.Message)
	}
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("%s %s: %v", query, id, err)
	}
	return v
}

// callAsLocked calls an update whose view locked some of its fields: one
// that changes a locked field must be refused (one that changes none may
// still be, for something else). changed are the fields payload changes;
// each lock must name a field of input, what the update takes, by its
// JSON path.
func (w *World) callAsLocked(t *rapid.T, action string, payload any, locked apperr.Locks, input any, changed ...string) {
	t.Helper()
	for field := range locked {
		if !hasField(reflect.TypeOf(input), strings.Split(field, ".")) {
			t.Fatalf("%s: its view locks %q, which it doesn't take", action, field)
		}
	}
	if _, refused := w.call(t, action, payload); refused != nil {
		return
	}
	for _, field := range changed {
		if lock, ok := locked[field]; ok {
			t.Fatalf("%s: the view locked %s (%q), the API changed it", action, field, lock.Why)
		}
	}
}

// hasField says whether a type has the field at a JSON path, through
// pointers, slices and embedded structs.
func hasField(typ reflect.Type, path []string) bool {
	for typ.Kind() == reflect.Pointer || typ.Kind() == reflect.Slice {
		typ = typ.Elem()
	}
	if len(path) == 0 {
		return true
	}
	if typ.Kind() != reflect.Struct {
		return false
	}
	for i := range typ.NumField() {
		f := typ.Field(i)
		name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		switch {
		case f.Anonymous && name == "":
			if hasField(f.Type, path) {
				return true
			}
		case name == path[0]:
			return hasField(f.Type, path[1:])
		}
	}
	return false
}

// dump is everything stored: the table, both calendars, the file store
// and the contacts.
func (w *World) dump(t *rapid.T) []byte {
	t.Helper()
	out := w.Table.Dump()
	for _, v := range []any{w.Calendar, w.Other, w.Blobs.Blobs, w.Contacts.People} {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatalf("dump: %v", err)
		}
		out = append(out, b...)
	}
	return out
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

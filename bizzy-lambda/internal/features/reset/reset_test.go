package reset_test

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"bizzy-lambda/internal/app"
	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/googleconnect"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
	"bizzy-lambda/internal/testutil/testapp"
)

// TestResetLeavesNoKeptReads resets with another Lambda warm on the same
// table: neither may read anything from before the reset that it kept.
func TestResetLeavesNoKeptReads(t *testing.T) {
	a := testapp.New()
	// another is a Lambda beside a's on the same table, Google and clock,
	// with reads of its own kept (see txn's cache).
	another := func() *app.App {
		ids := 1000
		return app.New(app.Deps{
			Table: a.Table, Blobs: a.Blobs, Contacts: a.Contacts, Resettable: true,
			Calendar: func(context.Context) (calendar.Calendar, error) { return a.Calendar, nil },
			Location: testapp.KL, Now: func() time.Time { return a.Now },
			NewID: func() string { ids++; return fmt.Sprintf("other%03d", ids) },
		})
	}
	b := another()
	call := func(x *app.App, action string, payload any) string {
		t.Helper()
		body, _ := json.Marshal(payload)
		res, _ := x.Router.Handle(context.Background(), router.Request{Action: action, Payload: body})
		if res.Error != nil {
			t.Fatalf("%s: %+v", action, res.Error)
		}
		out, _ := json.Marshal(res.Data)
		return string(out)
	}
	reads := []struct {
		action  string
		payload any
	}{
		{"clients.list", nil}, {"todo.list", nil}, {"sessions.search", map[string]any{"text": ""}},
		{"packages.list", map[string]any{"all": true}}, {"activity.list", nil}, {"app.status", nil},
		{"documents.search", map[string]any{"type": "invoice"}}, {"followUps.search", map[string]any{"view": followups.ListUpcoming}},
	}
	// agree checks a and b read what a Lambda that kept nothing reads.
	agree := func(when string) map[string]string {
		t.Helper()
		cold := another()
		got := map[string]string{}
		for _, r := range reads {
			want := call(cold, r.action, r.payload)
			for name, x := range map[string]*app.App{"a": a.App, "b": b} {
				if read := call(x, r.action, r.payload); read != want {
					t.Errorf("%s, %s on %s:\n kept   %s\n stored %s", when, r.action, name, read, want)
				}
			}
			got[r.action] = want
		}
		return got
	}

	call(a.App, "sync.run", nil)
	jane, err := a.Client("Jane Smith", map[string]any{"fee": map[string]any{"cents": 9000}})
	if err != nil {
		t.Fatal(err)
	}
	for i := range 3 {
		start := testapp.Epoch.Add(time.Duration(24*i-24) * time.Hour)
		call(a.App, "sessions.create", map[string]any{"clientId": jane, "time": map[string]any{"start": start, "end": start.Add(time.Hour)}})
	}
	before := agree("before the reset") // b keeps all it read

	call(a.App, "data.reset", nil)

	after := agree("after the reset")
	if after["clients.list"] != "[]" {
		t.Errorf("clients after the reset: %s", after["clients.list"])
	}
	if after["sessions.search"] == before["sessions.search"] {
		t.Error("the sessions survived the reset")
	}
	var status app.StatusView
	if err := json.Unmarshal([]byte(after["app.status"]), &status); err != nil || status.Sync == nil || status.Sync.Error != "" {
		t.Errorf("after the reset: %s, %v; want it synced", after["app.status"], err)
	}
	// The calendar's events name a client that is gone: they wait.
	var todo []struct{ Kind string }
	_ = json.Unmarshal([]byte(after["todo.list"]), &todo)
	if waiting := len(todo); waiting != 3 {
		t.Errorf("to-do after the reset: %s; want the 3 events waiting", after["todo.list"])
	}

	// The other Lambda adds the client back: the edits go in, and both see it.
	call(b, "clients.create", map[string]any{
		"name": "Jane Smith", "contact": map[string]any{"resourceName": a.Contact("Jane Smith")}, "fee": map[string]any{"cents": 9000},
	})
	again := agree("after adding the client back")
	if again["sessions.search"] == after["sessions.search"] || strings.Contains(again["todo.list"], `"conflict"`) {
		t.Errorf("the waiting edits didn't go in: %s", again["todo.list"])
	}

	// What the reset kept moved on, so no Lambda takes it as it was.
	versions, err := a.Table.Versions(context.Background(), txn.Commits)
	if err != nil || versions[googleconnect.Connections.Name] == 0 || versions[txn.SchemaKey.PK] == 0 {
		t.Errorf("versions after the reset: %v, %v; want the kept partitions' moved on", versions, err)
	}
}

package googlesync_test

import (
	"testing"
	"time"

	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/txn"
	"bizzy-lambda/internal/testutil/testapp"
)

func at(hour int) time.Time { return testapp.Epoch.Add(time.Duration(hour) * time.Hour) }

func setup(t *testing.T, names ...string) (*testapp.App, []string) {
	t.Helper()
	a := testapp.New()
	var ids []string
	for _, name := range names {
		id, err := a.Client(name, map[string]any{"feeRates": []map[string]any{{"cents": 9000}}})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	return a, ids
}

func sync(t *testing.T, a *testapp.App) {
	t.Helper()
	a.Now = a.Now.Add(time.Minute)
	if err := a.Must("sync.run", nil, nil); err != nil {
		t.Fatal(err)
	}
}

func listSessions(t *testing.T, a *testapp.App) []sessions.View {
	t.Helper()
	var out []sessions.View
	if err := a.Must("sessions.list", map[string]any{"from": at(-48), "to": at(72)}, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func waiting(t *testing.T, a *testapp.App) []conflicts.View {
	t.Helper()
	var out []conflicts.View
	if err := a.Must("conflicts.list", nil, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// eventOf is the event that shows an item.
func eventOf(t *testing.T, a *testapp.App, kind googlesync.ItemKind, id string) string {
	t.Helper()
	got, err := txn.Read(t.Context(), a.Runner, func(tx *txn.Tx) (string, error) {
		l, err := googlesync.LinkOf(tx, kind, id)
		if l == nil {
			return "", err
		}
		return l.EventID, err
	})
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func title(t *testing.T, a *testapp.App, id string) string {
	t.Helper()
	e, err := a.Calendar.Get(t.Context(), id)
	if err != nil {
		t.Fatal(err)
	}
	return e.Title
}

func TestTheCalendarDoesWhatTheAppDoes(t *testing.T) {
	a, ids := setup(t, "Jane Smith")
	jane := ids[0]

	// A new event books a session; its title is written back as bizzy
	// writes it.
	ev := a.Calendar.UserAdd("? jane  smith", at(2), at(3))
	sync(t, a)
	got := listSessions(t, a)
	if len(got) != 1 || got[0].ClientID != jane || !got[0].Tentative || eventOf(t, a, googlesync.KindSession, got[0].ID) != ev {
		t.Fatalf("sessions = %+v", got)
	}
	if title(t, a, ev) != "? jane smith" {
		t.Errorf("title = %q, want the name as written, its spacing tidied", title(t, a, ev))
	}

	// Confirming, moving and typing a fee there are the same update as in
	// the app.
	a.Calendar.UserEdit(ev, func(e *calendar.Event) { e.Title, e.Start, e.End = "Jane Smith 95", at(5), at(6) })
	sync(t, a)
	if s := listSessions(t, a)[0]; s.Tentative || !s.Start.Equal(at(5)) || s.FeeCents != 9500 || !s.FeeTyped {
		t.Errorf("after the edit: %+v", s)
	}

	// An edit bizzy refuses waits, and is settled by putting bizzy's back.
	a.Calendar.UserEdit(ev, func(e *calendar.Event) { e.Title = "Zed" })
	sync(t, a)
	w := waiting(t, a)
	if len(w) != 1 || w[0].EventID != ev || w[0].Remedies[len(w[0].Remedies)-1].Action != "calendar.revert" {
		t.Fatalf("waiting = %+v, want one with add-client and revert", w)
	}
	if err := a.Must("calendar.revert", map[string]any{"id": ev}, nil); err != nil {
		t.Fatal(err)
	}
	if title(t, a, ev) != "Jane Smith 95" || len(waiting(t, a)) != 0 {
		t.Errorf("after revert: title %q, waiting %v", title(t, a, ev), waiting(t, a))
	}

	// Deleting the event deletes the session.
	a.Calendar.UserDelete(ev)
	sync(t, a)
	if got := listSessions(t, a); len(got) != 0 {
		t.Errorf("sessions = %+v, want none", got)
	}
}

func TestAFixInTheAppLetsAWaitingEditThrough(t *testing.T) {
	a, _ := setup(t)
	ev := a.Calendar.UserAdd("Zed Ong 80", at(2), at(3))
	sync(t, a)
	w := waiting(t, a)
	if len(w) != 1 || w[0].Remedies[0].Action != "clients.create" {
		t.Fatalf("waiting = %+v, want adding Zed as a client", w)
	}

	// The remedy, as the app sends it once the user picks the contact,
	// then applying the edit.
	req := w[0].Remedies[0].Request
	req["contact"] = map[string]any{"resourceName": a.Contact("Zed Ong")}
	if err := a.Must("clients.create", req, nil); err != nil {
		t.Fatal(err)
	}
	if err := a.Must("conflicts.apply", map[string]any{"id": ev}, nil); err != nil {
		t.Fatal(err)
	}
	if got := listSessions(t, a); len(got) != 1 || got[0].FeeCents != 8000 || len(waiting(t, a)) != 0 {
		t.Errorf("sessions %+v, waiting %+v", got, waiting(t, a))
	}
}

func TestSwappedSessionsBothMove(t *testing.T) {
	a, _ := setup(t, "Jane Smith", "Bob Lee")
	jane := a.Calendar.UserAdd("Jane Smith", at(2), at(3))
	bob := a.Calendar.UserAdd("Bob Lee", at(3), at(4))
	sync(t, a)

	// Each move alone overlaps the other session: they fit only together.
	a.Calendar.UserEdit(jane, func(e *calendar.Event) { e.Start, e.End = at(3), at(4) })
	a.Calendar.UserEdit(bob, func(e *calendar.Event) { e.Start, e.End = at(2), at(3) })
	sync(t, a)
	got := listSessions(t, a)
	if len(got) != 2 || got[0].ClientName != "Bob Lee" || got[1].ClientName != "Jane Smith" || len(waiting(t, a)) != 0 {
		t.Errorf("sessions %+v, waiting %+v", got, waiting(t, a))
	}
}

func TestEveryEventIsBizzys(t *testing.T) {
	a, _ := setup(t, "Jane Smith")

	// A follow-up there is one here.
	fu := a.Calendar.UserAddAllDay("! Jane Smith: call back", "2026-10-15")
	// An all-day event that isn't one is refused; taking it away deletes
	// it.
	party := a.Calendar.UserAddAllDay("Birthday", "2026-10-16")
	sync(t, a)
	var listed []followups.View
	if err := a.Must("followUps.list", map[string]any{"view": "upcoming"}, &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].Summary != "call back" || !listed[0].AllDay || title(t, a, fu) != "! Jane Smith: call back" {
		t.Errorf("follow-ups = %+v, title %q", listed, title(t, a, fu))
	}
	w := waiting(t, a)
	if len(w) != 1 || w[0].EventID != party || w[0].Remedies[0].Label != "Delete the event" {
		t.Fatalf("waiting = %+v", w)
	}
	if err := a.Must("calendar.revert", map[string]any{"id": party}, nil); err != nil {
		t.Fatal(err)
	}
	if e, _ := a.Calendar.Get(t.Context(), party); !e.Cancelled || len(waiting(t, a)) != 0 {
		t.Errorf("after revert: %+v, waiting %v", e, waiting(t, a))
	}
}

func TestACalendarDeleteKeepsTheNotes(t *testing.T) {
	a, _ := setup(t, "Jane Smith")
	ev := a.Calendar.UserAdd("Jane Smith", at(-3), at(-2))
	sync(t, a)
	s := listSessions(t, a)[0]
	if err := a.Must("sessions.saveRecord", map[string]any{"id": s.ID, "summary": "Knee, better"}, nil); err != nil {
		t.Fatal(err)
	}

	a.Calendar.UserDelete(ev)
	sync(t, a)
	w := waiting(t, a)
	if len(w) != 1 || !w[0].Gone || len(listSessions(t, a)) != 1 {
		t.Fatalf("waiting = %+v", w)
	}
	// Putting it back writes it again, as a new event.
	if err := a.Must("calendar.revert", map[string]any{"id": ev}, nil); err != nil {
		t.Fatal(err)
	}
	again := eventOf(t, a, googlesync.KindSession, s.ID)
	if again == "" || again == ev || title(t, a, again) != "Jane Smith" || len(waiting(t, a)) != 0 {
		t.Errorf("after revert: event %q, waiting %v", again, waiting(t, a))
	}
}

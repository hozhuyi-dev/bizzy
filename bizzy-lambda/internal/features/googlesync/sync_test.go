package googlesync_test

import (
	"strings"
	"testing"
	"time"

	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/listing"
	"bizzy-lambda/internal/platform/txn"
	"bizzy-lambda/internal/testutil/fakecal"
	"bizzy-lambda/internal/testutil/testapp"
)

func at(hour int) time.Time { return testapp.Epoch.Add(time.Duration(hour) * time.Hour) }

func setup(t *testing.T, names ...string) (*testapp.App, []string) {
	t.Helper()
	a := testapp.New()
	var ids []string
	for _, name := range names {
		id, err := a.Client(name, map[string]any{"fee": map[string]any{"cents": 9000}})
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
	a.Calendar.UserAdd("Zed Ong 80", at(2), at(3))
	a.Calendar.UserAdd("Zed Ong 80", at(26), at(27))
	sync(t, a)
	w := waiting(t, a)
	if len(w) != 2 || w[0].Remedies[0].Action != "clients.create" {
		t.Fatalf("waiting = %+v, want adding Zed as a client", w)
	}

	// The remedy, as the app sends it once the user picks the contact: it
	// lets every edit waiting on Zed through, with nothing to apply.
	req := w[0].Remedies[0].Request
	req["contact"] = map[string]any{"resourceName": a.Contact("Zed Ong")}
	if err := a.Must("clients.create", req, nil); err != nil {
		t.Fatal(err)
	}
	if got := listSessions(t, a); len(got) != 2 || got[0].FeeCents != 8000 || len(waiting(t, a)) != 0 {
		t.Errorf("sessions %+v, waiting %+v", got, waiting(t, a))
	}
}

func TestAWaitingEditStillRefusedSaysWhyAsItIsNow(t *testing.T) {
	a, _ := setup(t, "Jane Smith")
	ev := a.Calendar.UserAdd("Zed Ong", at(2), at(3))
	sync(t, a)

	// Zed is added with no usual fee: the edit is tried again, and now
	// waits for the fee instead of the client.
	if _, err := a.Client("Zed Ong", nil); err != nil {
		t.Fatal(err)
	}
	w := waiting(t, a)
	if len(w) != 1 || w[0].EventID != ev || !strings.Contains(w[0].Message, "fee") {
		t.Fatalf("waiting = %+v, want one waiting for Zed's fee", w)
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
	var page listing.Page[followups.View]
	if err := a.Must("followUps.search", map[string]any{"view": "upcoming"}, &page); err != nil {
		t.Fatal(err)
	}
	listed := page.Items
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

func TestACalendarDeleteCancelsWhatHasHistory(t *testing.T) {
	a, _ := setup(t, "Jane Smith")
	recorded := a.Calendar.UserAdd("Jane Smith", at(-3), at(-2))
	booked := a.Calendar.UserAdd("Jane Smith", at(30), at(31))
	sync(t, a)
	ss := listSessions(t, a)
	if len(ss) != 2 {
		t.Fatalf("sessions = %+v", ss)
	}
	past := ss[0]
	if past.Start.After(ss[1].Start) {
		past = ss[1]
	}
	if err := a.Must("sessions.saveRecord", map[string]any{"id": past.ID, "summary": "Knee, better"}, nil); err != nil {
		t.Fatal(err)
	}

	// The one that happened is cancelled, with its notes; the one booked
	// by mistake goes.
	a.Calendar.UserDelete(recorded)
	a.Calendar.UserDelete(booked)
	sync(t, a)
	if w := waiting(t, a); len(w) != 0 {
		t.Fatalf("waiting = %+v", w)
	}
	ss = listSessions(t, a)
	if len(ss) != 1 || ss[0].ID != past.ID || ss[0].CancelledAt == nil || ss[0].Record.Summary != "Knee, better" {
		t.Fatalf("sessions = %+v", ss)
	}
	if ev := eventOf(t, a, googlesync.KindSession, past.ID); ev != "" {
		t.Errorf("the cancelled session still shows in %s", ev)
	}
}

func day(n int) time.Time { return at(24 * n) }

// allSessions are every session, however long ago, by time.
func allSessions(t *testing.T, a *testapp.App) []*sessions.Session {
	t.Helper()
	out, err := txn.Read(t.Context(), a.Runner, func(tx *txn.Tx) ([]*sessions.Session, error) {
		return sessions.Sessions.Between(tx, time.Time{}, day(400))
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// backfill reads the calendar back as far as it goes, as the app does
// after a sync.
func backfill(t *testing.T, a *testapp.App) {
	t.Helper()
	for range 100 {
		var v googlesync.View
		if err := a.Must("sync.backfill", nil, &v); err != nil {
			t.Fatal(err)
		}
		if v.Back == "" {
			return
		}
	}
	t.Fatal("the backfill never ends")
}

// choose makes a new calendar the one chosen, as Settings does.
func choose(a *testapp.App, name string) *fakecal.Calendar {
	c := &fakecal.Calendar{Name: name, Now: func() time.Time { return a.Now }}
	a.Calendar = c
	return c
}

func TestTheFirstSyncReadsBackAWindowAndTheBackfillTheRest(t *testing.T) {
	a, _ := setup(t, "Jane Smith")
	a.Calendar.UserAdd("Jane Smith", day(-10), day(-10).Add(time.Hour))
	old := a.Calendar.UserAdd("Jane Smith", day(-90), day(-90).Add(time.Hour))
	a.Calendar.UserAdd("Jane Smith", day(-400), day(-400).Add(time.Hour))

	var v googlesync.View
	if err := a.Must("sync.run", nil, &v); err != nil {
		t.Fatal(err)
	}
	if got := allSessions(t, a); len(got) != 1 || v.Back == "" {
		t.Fatalf("after the first sync: %d sessions, back %q; want the one in the window, and more to read", len(got), v.Back)
	}
	backfill(t, a)
	if got := allSessions(t, a); len(got) != 3 {
		t.Fatalf("after the backfill: %d sessions, want 3", len(got))
	}

	// An edit to an old event is read like any.
	a.Calendar.UserEdit(old, func(e *calendar.Event) { e.Title = "Jane Smith 95" })
	sync(t, a)
	if got := allSessions(t, a); len(got) != 3 || len(waiting(t, a)) != 0 {
		t.Fatalf("after the edit: %d sessions, waiting %+v", len(got), waiting(t, a))
	}
	var s []sessions.View
	if err := a.Must("sessions.list", map[string]any{"from": day(-91), "to": day(-89)}, &s); err != nil {
		t.Fatal(err)
	}
	if len(s) != 1 || s[0].FeeCents != 9500 {
		t.Errorf("the old session is %+v, want its fee typed in the calendar", s)
	}
}

func TestANewCalendarShowsEverySession(t *testing.T) {
	a, _ := setup(t, "Jane Smith", "Bob Lee")
	first := a.Calendar
	first.UserAdd("Jane Smith", day(-90), day(-90).Add(time.Hour))
	first.UserAdd("Jane Smith", day(-10), day(-10).Add(time.Hour))
	first.UserAdd("Bob Lee", day(5), day(5).Add(time.Hour))
	first.UserAddAllDay("! Bob Lee: send exercises", "2026-10-20")
	sync(t, a)
	backfill(t, a)

	clinic := choose(a, "clinic")
	sync(t, a)
	backfill(t, a)
	if got := allSessions(t, a); len(got) != 3 || len(clinic.Live) != 4 || len(waiting(t, a)) != 0 {
		t.Fatalf("%d sessions, %d events in the new calendar, waiting %+v; want 3, 4, none", len(got), len(clinic.Live), waiting(t, a))
	}
	for _, s := range allSessions(t, a) {
		if ev := eventOf(t, a, googlesync.KindSession, s.ID); !strings.HasPrefix(ev, "clinic-") {
			t.Errorf("session at %v shows in %q, not the new calendar", s.Start, ev)
		}
	}
	// The calendar left is left as it was.
	if len(first.Live) != 4 || len(first.Trash) != 0 {
		t.Errorf("the calendar left has %d events, %d deleted", len(first.Live), len(first.Trash))
	}
}

func TestACopyInTheNewCalendarWaits(t *testing.T) {
	a, _ := setup(t, "Jane Smith")
	a.Calendar.UserAdd("Jane Smith", at(2), at(3))
	sync(t, a)

	// The new calendar has the session already, typed in by hand.
	clinic := choose(a, "clinic")
	copied := clinic.UserAdd("Jane Smith", at(2), at(3))
	sync(t, a)
	w := waiting(t, a)
	if got := allSessions(t, a); len(got) != 1 || len(w) != 1 || w[0].EventID != copied || len(clinic.Live) != 2 {
		t.Fatalf("%d sessions, waiting %+v, %d events; want the copy waiting beside bizzy's own", len(got), w, len(clinic.Live))
	}
}

func TestChoosingACalendarAgainKeepsBizzysVersion(t *testing.T) {
	a, _ := setup(t, "Jane Smith")
	first := a.Calendar
	ev := first.UserAdd("Jane Smith", at(2), at(3))
	sync(t, a)

	clinic := choose(a, "clinic")
	sync(t, a)
	moved := eventOf(t, a, googlesync.KindSession, allSessions(t, a)[0].ID)
	clinic.UserEdit(moved, func(e *calendar.Event) { e.Start, e.End = at(5), at(6) })
	sync(t, a)

	// Back to the first, whose event still says 2 o'clock.
	a.Calendar = first
	sync(t, a)
	got := allSessions(t, a)
	if len(got) != 1 || !got[0].Start.Equal(at(5)) || len(waiting(t, a)) != 0 {
		t.Fatalf("sessions %+v, waiting %+v; want the session where it was moved to", got, waiting(t, a))
	}
	if e, _ := first.Get(t.Context(), ev); !e.Start.Equal(at(5)) || eventOf(t, a, googlesync.KindSession, got[0].ID) != ev {
		t.Errorf("the old event says %v, want it written over and shown again", e.Start)
	}
}

func TestAWaitingEditWaitsForTheNewCalendarsSync(t *testing.T) {
	a, _ := setup(t, "Jane Smith")
	ev := a.Calendar.UserAdd("Jane Smith", at(2), at(3))
	sync(t, a)
	a.Calendar.UserEdit(ev, func(e *calendar.Event) { e.Title = "Zed" })
	sync(t, a)
	if len(waiting(t, a)) != 1 {
		t.Fatal("want the edit waiting")
	}

	// Its event isn't in the calendar chosen now, but it isn't deleted.
	choose(a, "clinic")
	for _, action := range []string{"conflicts.apply", "calendar.revert"} {
		if _, refused, err := a.Call(action, map[string]any{"id": ev}); err != nil || refused == nil {
			t.Errorf("%s: %v, %v; want it refused until the sync", action, refused, err)
		}
	}
	sync(t, a)
	if got := allSessions(t, a); len(got) != 1 || len(waiting(t, a)) != 0 {
		t.Errorf("%d sessions, waiting %+v; want the session, and the old calendar's edit forgotten", len(got), waiting(t, a))
	}
}

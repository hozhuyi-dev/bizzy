package googlesync

import (
	"context"
	"testing"
	"time"

	"bizzy-lambda/internal/features/billing"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/docref"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/testutil/memory"
)

var now = time.Date(2026, 10, 11, 13, 0, 0, 0, time.UTC)

type fakeCalendar struct {
	events []calendar.Event
	// trash holds deleted events, which Restore brings back.
	trash []calendar.Event
}

func (f *fakeCalendar) Events(_ context.Context, from, to time.Time) ([]calendar.Event, error) {
	var out []calendar.Event
	for _, e := range f.events {
		start := e.Start
		if e.AllDay {
			start, _ = time.Parse(time.DateOnly, e.Date)
		}
		if !start.Before(from) && start.Before(to) {
			out = append(out, e)
		}
	}
	return out, nil
}

func ev(id string, daysAgo int, title string) calendar.Event {
	start := now.Add(-time.Duration(daysAgo) * 24 * time.Hour)
	return calendar.Event{ID: id, Title: title, Start: start, End: start.Add(time.Hour)}
}

func newSyncer(m *memory.Store, cal *fakeCalendar) Syncer {
	return Syncer{
		Events:    cal,
		Clients:   m.Clients(),
		Sessions:  m.Sessions(),
		FollowUps: m.FollowUps(),
		Billing:   newReconciler(m),
		Location:  time.UTC,
		Now:       func() time.Time { return now },
	}
}

func newReconciler(m *memory.Store) *billing.Reconciler {
	return &billing.Reconciler{
		Clients: m.Clients(), Sessions: m.Sessions(), Packages: m.Packages(), Settings: m.Settings(),
		Location: time.UTC,
		Now:      func() time.Time { return now },
	}
}

func setup() (*memory.Store, *fakeCalendar) {
	m := memory.New()
	fee := int64(9000)
	m.ClientMap["jane"] = clients.Client{ID: "jane", Name: "Jane Smith", Aliases: []string{"jane smith"}, DefaultFeeCents: &fee}
	return m, &fakeCalendar{}
}

func TestRunImportsAndIsIdempotent(t *testing.T) {
	m, cal := setup()
	cal.events = []calendar.Event{
		ev("e1", 3, "Jane Smith"),
		ev("e2", 2, "Bob Lee 120"),
		ev("e3", 1, "Pick up kids"),
		{ID: "e4", Title: "Jane Smith", Start: now.Add(-24 * time.Hour), AllDay: true},
		{ID: "e5", Title: "Jane Smith", Start: now.Add(-24 * time.Hour), Cancelled: true},
	}
	s := newSyncer(m, cal)

	summary, err := s.Run(context.Background(), Range{})
	if err != nil {
		t.Fatal(err)
	}
	if summary.Sessions != 3 || summary.Saved != 3 {
		t.Errorf("summary = %+v", summary)
	}
	// Every timed event is a session; names she hasn't linked wait on her.
	if got := m.SessionMap["e1"].Status; got != sessions.StatusPriced {
		t.Errorf("e1 status = %s, want priced", got)
	}
	for _, id := range []string{"e2", "e3"} {
		if got := m.SessionMap[id].Status; got != sessions.StatusUnmatched {
			t.Errorf("%s status = %s, want unmatched", id, got)
		}
	}
	if len(m.SessionMap) != 3 {
		t.Errorf("stored %d sessions, want 3 (all-day and cancelled skipped)", len(m.SessionMap))
	}

	m.Writes = 0
	summary, err = s.Run(context.Background(), Range{})
	if err != nil {
		t.Fatal(err)
	}
	if m.Writes != 0 || summary.Saved != 0 {
		t.Errorf("second run wrote %d items (summary %+v), want none", m.Writes, summary)
	}
}

func TestRunRemovesDeletedEvents(t *testing.T) {
	m, cal := setup()
	cal.events = []calendar.Event{ev("e1", 3, "Jane Smith"), ev("e2", 2, "Jane Smith")}
	s := newSyncer(m, cal)
	if _, err := s.Run(context.Background(), Range{}); err != nil {
		t.Fatal(err)
	}

	// e1 deleted; e2 cancelled.
	e2 := ev("e2", 2, "Jane Smith")
	e2.Cancelled = true
	cal.events = []calendar.Event{e2}
	if _, err := s.Run(context.Background(), Range{}); err != nil {
		t.Fatal(err)
	}
	if len(m.SessionMap) != 0 {
		t.Errorf("sessions left: %v", m.SessionMap)
	}
}

func TestRunKeepsReceiptedSessionAsRemoved(t *testing.T) {
	m, cal := setup()
	cal.events = []calendar.Event{ev("e1", 3, "Jane Smith")}
	s := newSyncer(m, cal)
	if _, err := s.Run(context.Background(), Range{}); err != nil {
		t.Fatal(err)
	}
	stored := m.SessionMap["e1"]
	stored.Receipt = &docref.Ref{DocumentID: "d1", Number: "RCP260001", ClientID: "jane"}
	m.SessionMap["e1"] = stored

	cal.events = nil
	if _, err := s.Run(context.Background(), Range{}); err != nil {
		t.Fatal(err)
	}

	got, ok := m.SessionMap["e1"]
	if !ok || got.Status != sessions.StatusRemoved || got.Drift == "" {
		t.Errorf("session = %+v, want kept as removed with drift", got)
	}
}

func TestRunRecordsNextBooking(t *testing.T) {
	m, cal := setup()
	soon := ev("f1", -5, "Jane Smith")
	later := ev("f2", -9, "Jane Smith")
	cal.events = []calendar.Event{later, soon}

	if _, err := newSyncer(m, cal).Run(context.Background(), Range{}); err != nil {
		t.Fatal(err)
	}
	if got := m.ClientMap["jane"].NextBookedAt; got == nil || !got.Equal(soon.Start) {
		t.Errorf("NextBookedAt = %v, want %v", got, soon.Start)
	}
	if s := m.SessionMap["f1"]; !s.Upcoming || s.Status != sessions.StatusPriced {
		t.Errorf("booking = %+v, want an upcoming session", s)
	}
}

func TestRunReconcilesSessionsOnceTheyHappen(t *testing.T) {
	m, cal := setup()
	cal.events = []calendar.Event{ev("f1", -1, "Jane Smith")}
	s := newSyncer(m, cal)
	if _, err := s.Run(context.Background(), Range{}); err != nil {
		t.Fatal(err)
	}
	if m.ClientMap["jane"].Activity != nil {
		t.Fatal("a booking is not activity yet")
	}

	later := now.Add(48 * time.Hour)
	s.Now = func() time.Time { return later }
	s.Billing = &billing.Reconciler{
		Clients: m.Clients(), Sessions: m.Sessions(), Packages: m.Packages(), Settings: m.Settings(),
		Location: time.UTC, Now: s.Now,
	}
	if _, err := s.Run(context.Background(), Range{}); err != nil {
		t.Fatal(err)
	}
	if got := m.SessionMap["f1"]; got.Upcoming {
		t.Error("still upcoming after it happened")
	}
	if a := m.ClientMap["jane"].Activity; len(a) != 1 {
		t.Errorf("activity = %v, want the session counted", a)
	}
}

func TestRunSyncsFollowUps(t *testing.T) {
	m, cal := setup()
	timed := ev("u1", 1, "! Jane Smith: Check MRI results")
	timed.Description = "Ask about the left knee too"
	timed.Private = map[string]string{calendar.PropSessionID: "e9"}
	allDay := calendar.Event{ID: "u2", Title: "! Bob: call", AllDay: true, Date: now.AddDate(0, 0, 3).Format(time.DateOnly)}
	cal.events = []calendar.Event{timed, allDay, ev("e1", 1, "Jane Smith")}
	s := newSyncer(m, cal)

	summary, err := s.Run(context.Background(), Range{})
	if err != nil {
		t.Fatal(err)
	}
	if summary.Sessions != 1 || summary.FollowUps != 2 || len(m.SessionMap) != 1 {
		t.Errorf("summary = %+v, sessions %d, want one session and two follow-ups", summary, len(m.SessionMap))
	}
	f := m.FollowUpMap["u1"]
	if f.ClientID != "jane" || f.Summary != "Check MRI results" || f.Notes != "Ask about the left knee too" || f.SessionID != "e9" {
		t.Errorf("follow-up = %+v", f)
	}
	if b := m.FollowUpMap["u2"]; !b.AllDay || b.ClientID != "" || b.Problem == "" || b.Due.Format(time.DateOnly) != allDay.Date {
		t.Errorf("all-day = %+v, want unmatched on its day", b)
	}

	// Done is hers: a quiet run keeps it and writes nothing.
	f.DoneAt = &now
	m.FollowUpMap["u1"] = f
	m.Writes = 0
	if _, err := s.Run(context.Background(), Range{}); err != nil {
		t.Fatal(err)
	}
	if m.Writes != 0 || m.FollowUpMap["u1"].DoneAt == nil {
		t.Errorf("writes = %d, done = %v", m.Writes, m.FollowUpMap["u1"].DoneAt)
	}

	// Deleted in the calendar.
	cal.events = cal.events[1:]
	if _, err := s.Run(context.Background(), Range{}); err != nil {
		t.Fatal(err)
	}
	if _, ok := m.FollowUpMap["u1"]; ok {
		t.Error("deleted follow-up kept")
	}
}

type fakeContacts []contacts.Person

func (f fakeContacts) List(context.Context) ([]contacts.Person, error) { return f, nil }

func TestRunRefreshesContactCopies(t *testing.T) {
	m, _ := setup()
	m.ClientMap["jane"] = withContact(m.ClientMap["jane"], clients.Contact{ResourceName: "people/jane", ETag: "j1", Phone: "012"})
	m.ClientMap["bob"] = withContact(clients.Client{ID: "bob", Name: "Bob", Aliases: []string{"bob"}}, clients.Contact{ResourceName: "people/bob", ETag: "b1", Phone: "019"})
	s := newSyncer(m, &fakeCalendar{})
	s.Contacts = fakeContacts{{ResourceName: "people/jane", ETag: "j2", Phone: "013", DisplayName: "Jane"}}

	summary, err := s.Run(context.Background(), Range{})
	if err != nil {
		t.Fatal(err)
	}
	if summary.Contacts != 2 {
		t.Errorf("summary.Contacts = %d, want 2", summary.Contacts)
	}
	if got := m.ClientMap["jane"].Contact; got.Phone != "013" || got.ETag != "j2" || got.Missing {
		t.Errorf("jane's contact = %+v, want the new phone", got)
	}
	if got := m.ClientMap["bob"].Contact; !got.Missing || got.Phone != "019" {
		t.Errorf("bob's contact = %+v, want marked missing with the old copy kept", got)
	}

	m.Writes = 0
	if _, err := s.Run(context.Background(), Range{}); err != nil {
		t.Fatal(err)
	}
	if m.Writes != 0 {
		t.Errorf("second run wrote %d items, want none", m.Writes)
	}
}

func withContact(c clients.Client, contact clients.Contact) clients.Client {
	c.Contact = &contact
	return c
}

func TestRunOnlyTouchesItsRange(t *testing.T) {
	m, cal := setup()
	cal.events = []calendar.Event{ev("old", 90, "Jane Smith"), ev("new", 3, "Jane Smith")}
	s := newSyncer(m, cal)
	if _, err := s.Run(context.Background(), Range{}); err != nil {
		t.Fatal(err)
	}

	// Both deleted in the calendar; a run over the last 60 days only
	// removes the recent one.
	cal.events = nil
	if _, err := s.Run(context.Background(), Range{From: now.Add(-SyncWindow)}); err != nil {
		t.Fatal(err)
	}
	if _, ok := m.SessionMap["old"]; !ok {
		t.Error("a session before the range was removed")
	}
	if _, ok := m.SessionMap["new"]; ok {
		t.Error("a session in the range was kept")
	}
}

func TestRunInputRange(t *testing.T) {
	loc := time.FixedZone("MYT", 8*60*60)
	day := func(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, loc) }

	tests := []struct {
		name string
		in   RunInput
		want Range
		err  bool
	}{
		{name: "default", in: RunInput{}, want: Range{From: now.Add(-SyncWindow)}},
		{name: "all", in: RunInput{All: true, From: "2026-01-01"}, want: Range{}},
		{name: "dates", in: RunInput{From: "2026-01-01", To: "2026-01-31"}, want: Range{From: day(2026, 1, 1), To: day(2026, 2, 1)}},
		{name: "one day", in: RunInput{From: "2026-01-01", To: "2026-01-01"}, want: Range{From: day(2026, 1, 1), To: day(2026, 1, 2)}},
		{name: "from only", in: RunInput{From: "2026-01-01"}, want: Range{From: day(2026, 1, 1)}},
		{name: "to only", in: RunInput{To: "2026-01-01"}, err: true},
		{name: "backwards", in: RunInput{From: "2026-02-01", To: "2026-01-01"}, err: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.in.Range(loc, now)
			if (err != nil) != tt.err {
				t.Fatalf("err = %v, want error %v", err, tt.err)
			}
			if !got.From.Equal(tt.want.From) || !got.To.Equal(tt.want.To) {
				t.Errorf("range = %+v, want %+v", got, tt.want)
			}
		})
	}
}

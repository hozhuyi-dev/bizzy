package calsync

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
}

func (f *fakeCalendar) Events(_ context.Context, from, to time.Time) ([]calendar.Event, error) {
	var out []calendar.Event
	for _, e := range f.events {
		if !e.Start.Before(from) && e.Start.Before(to) {
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
		Events:   cal,
		Clients:  m.Clients(),
		Sessions: m.Sessions(),
		Billing: &billing.Reconciler{
			Clients: m.Clients(), Sessions: m.Sessions(), Packages: m.Packages(), Settings: m.Settings(),
			Location: time.UTC,
		},
		Window:    30 * 24 * time.Hour,
		Lookahead: 60 * 24 * time.Hour,
		Now:       func() time.Time { return now },
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

	summary, err := s.Run(context.Background())
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
	summary, err = s.Run(context.Background())
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
	if _, err := s.Run(context.Background()); err != nil {
		t.Fatal(err)
	}

	// e1 deleted; e2 cancelled.
	e2 := ev("e2", 2, "Jane Smith")
	e2.Cancelled = true
	cal.events = []calendar.Event{e2}
	if _, err := s.Run(context.Background()); err != nil {
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
	if _, err := s.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	stored := m.SessionMap["e1"]
	stored.Document = &docref.Ref{DocumentID: "d1", Number: "RCP-0001", ClientID: "jane"}
	m.SessionMap["e1"] = stored

	cal.events = nil
	if _, err := s.Run(context.Background()); err != nil {
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

	if _, err := newSyncer(m, cal).Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := m.ClientMap["jane"].NextBookedAt; got == nil || !got.Equal(soon.Start) {
		t.Errorf("NextBookedAt = %v, want %v", got, soon.Start)
	}
	if len(m.SessionMap) != 0 {
		t.Error("future events must not become sessions")
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

	summary, err := s.Run(context.Background())
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
	if _, err := s.Run(context.Background()); err != nil {
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

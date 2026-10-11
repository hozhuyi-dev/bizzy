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
	}
	s := newSyncer(m, cal)

	summary, err := s.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if summary.Sessions != 1 || summary.Unmatched != 1 || summary.Skipped != 1 || summary.Saved != 2 {
		t.Errorf("summary = %+v", summary)
	}
	if len(m.SessionMap) != 2 {
		t.Errorf("stored %d sessions, want 2", len(m.SessionMap))
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

	// e1 deleted; e2 renamed to a personal event.
	cal.events = []calendar.Event{ev("e2", 2, "Dentist")}
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

type fakeDismissed map[string]string

func (f fakeDismissed) List(context.Context) (map[string]string, error) { return f, nil }

func TestRunSuggestsContactsForUnknownNames(t *testing.T) {
	m, cal := setup()
	m.ClientMap["jane"] = withContact(m.ClientMap["jane"], clients.Contact{ResourceName: "people/jane", ETag: "j1", DisplayName: "Jane Smith-Wong"})
	cal.events = []calendar.Event{
		ev("e1", 3, "Mary Tan"),        // a contact, not a client yet
		ev("e2", 2, "Jane Smith-Wong"), // Jane's contact name, not one of her aliases
		ev("e3", 1, "Mum"),             // dismissed
	}
	s := newSyncer(m, cal)
	s.Contacts = fakeContacts{
		{ResourceName: "people/mary", ETag: "m1", DisplayName: "Mary Tan", GivenName: "Mary", FamilyName: "Tan"},
		{ResourceName: "people/jane", ETag: "j1", DisplayName: "Jane Smith-Wong"},
		{ResourceName: "people/mum", ETag: "u1", DisplayName: "Mum"},
	}
	s.Dismissed = fakeDismissed{"people/mum": "Mum"}

	summary, err := s.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if summary.Unmatched != 2 || summary.Skipped != 1 {
		t.Errorf("summary = %+v", summary)
	}

	mary := m.SessionMap["e1"]
	if mary.Status != sessions.StatusUnmatched || len(mary.SuggestedContacts) != 1 || mary.SuggestedContacts[0].ResourceName != "people/mary" {
		t.Errorf("e1 = %+v, want unmatched suggesting Mary", mary)
	}
	if got := m.SessionMap["e2"].SuggestedContacts; len(got) != 1 || got[0].ClientID != "jane" {
		t.Errorf("e2 suggestions = %+v, want Jane's contact with her client id", got)
	}
	if _, ok := m.SessionMap["e3"]; ok {
		t.Error("a dismissed contact's entry must stay personal")
	}

	m.Writes = 0
	if _, err := s.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if m.Writes != 0 {
		t.Errorf("second run wrote %d items, want none", m.Writes)
	}
}

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

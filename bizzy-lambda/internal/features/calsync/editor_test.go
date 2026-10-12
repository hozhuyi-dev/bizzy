package calsync

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"bizzy-lambda/internal/features/billing"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/docref"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/testutil/memory"
)

// The fake calendar's write side. Every write bumps the event's etag, and a
// write against an older one is refused, as Google does.

func (f *fakeCalendar) find(id string) int {
	return slices.IndexFunc(f.events, func(e calendar.Event) bool { return e.ID == id })
}

func (f *fakeCalendar) Get(_ context.Context, id string) (calendar.Event, error) {
	i := f.find(id)
	if i < 0 {
		return calendar.Event{}, calendar.ErrGone
	}
	return f.events[i], nil
}

func (f *fakeCalendar) Insert(_ context.Context, in calendar.EventInput) (calendar.Event, error) {
	e := calendar.Event{ID: fmt.Sprintf("new%d", len(f.events)+1), ETag: "1", Title: in.Title, Start: in.Start, End: in.End, ColorID: in.ColorID}
	f.events = append(f.events, e)
	return e, nil
}

func (f *fakeCalendar) Update(_ context.Context, id, etag string, in calendar.EventInput) (calendar.Event, error) {
	i := f.find(id)
	if i < 0 {
		return calendar.Event{}, calendar.ErrGone
	}
	e := &f.events[i]
	if e.ETag != etag {
		return calendar.Event{}, calendar.ErrChanged
	}
	e.Title, e.Start, e.End, e.ColorID, e.ETag = in.Title, in.Start, in.End, in.ColorID, e.ETag+"+"
	return *e, nil
}

func (f *fakeCalendar) Delete(_ context.Context, id, etag string) error {
	i := f.find(id)
	if i < 0 {
		return calendar.ErrGone
	}
	if f.events[i].ETag != etag {
		return calendar.ErrChanged
	}
	f.events = slices.Delete(f.events, i, i+1)
	return nil
}

func newEditor(m *memory.Store, cal *fakeCalendar) Editor {
	return Editor{
		Calendar: func(context.Context) (Calendar, error) { return cal, nil },
		Clients:  m.Clients(),
		Sessions: m.Sessions(),
		Settings: m.Settings(),
		Billing: &billing.Reconciler{
			Clients: m.Clients(), Sessions: m.Sessions(), Packages: m.Packages(), Settings: m.Settings(),
			Location: time.UTC,
		},
		Lookahead: BookingLookahead,
		Now:       func() time.Time { return now },
	}
}

// synced puts events in the calendar and runs the sync, as if she had
// written them in Google.
func synced(t *testing.T, m *memory.Store, cal *fakeCalendar, events ...calendar.Event) {
	t.Helper()
	for _, e := range events {
		e.ETag = "1"
		cal.events = append(cal.events, e)
	}
	if _, err := newSyncer(m, cal).Run(context.Background()); err != nil {
		t.Fatal(err)
	}
}

// quiet checks that a sync after the edit has nothing left to do.
func quiet(t *testing.T, m *memory.Store, cal *fakeCalendar) {
	t.Helper()
	m.Writes = 0
	if _, err := newSyncer(m, cal).Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if m.Writes != 0 {
		t.Errorf("the sync after the edit wrote %d items, want none", m.Writes)
	}
}

func fee(v int64) *int64 { return &v }

func TestCreatePastSession(t *testing.T) {
	m, cal := setup()
	e := newEditor(m, cal)
	start := now.Add(-48 * time.Hour)

	_, err := e.create(context.Background(), Draft{ClientID: "jane", Start: start, FeeCents: fee(9550)})
	if err != nil {
		t.Fatal(err)
	}

	if len(cal.events) != 1 {
		t.Fatalf("calendar = %+v, want one event", cal.events)
	}
	event := cal.events[0]
	if event.Title != "Jane Smith 95.50" || !event.End.Equal(start.Add(time.Hour)) || event.ColorID != "" {
		t.Errorf("event = %+v", event)
	}
	got := m.SessionMap[event.ID]
	if got.Status != sessions.StatusPriced || *got.FeeCents != 9550 {
		t.Errorf("session = %+v, want priced at 95.50", got)
	}
	quiet(t, m, cal)
}

func TestCreateFutureSessionIsABooking(t *testing.T) {
	m, cal := setup()
	e := newEditor(m, cal)
	start := now.Add(72 * time.Hour)

	if _, err := e.create(context.Background(), Draft{ClientID: "jane", Start: start, Tentative: true}); err != nil {
		t.Fatal(err)
	}

	if len(m.SessionMap) != 0 {
		t.Errorf("sessions = %v, want none until it happens", m.SessionMap)
	}
	if cal.events[0].Title != "? Jane Smith" {
		t.Errorf("title = %q", cal.events[0].Title)
	}
	if got := m.ClientMap["jane"].NextBookedAt; got == nil || !got.Equal(start) {
		t.Errorf("NextBookedAt = %v, want %v", got, start)
	}
}

func TestCreateRefusesUnknownClient(t *testing.T) {
	m, cal := setup()
	_, err := newEditor(m, cal).create(context.Background(), Draft{ClientID: "nobody", Start: now})
	var appErr *apperr.Error
	if !errors.As(err, &appErr) || appErr.Code != apperr.CodeNotFound || len(cal.events) != 0 {
		t.Errorf("err = %v, events = %v", err, cal.events)
	}
}

func TestUpdateConfirmsAndKeepsHerName(t *testing.T) {
	m, cal := setup()
	jane := m.ClientMap["jane"]
	jane.Aliases = append(jane.Aliases, "janey")
	m.ClientMap["jane"] = jane
	synced(t, m, cal, ev("e1", 1, "? Janey 95"))
	if got := m.SessionMap["e1"].Status; got != sessions.StatusTentative {
		t.Fatalf("status = %s, want tentative", got)
	}

	// As the app does: start from the draft, untick "not confirmed".
	e := newEditor(m, cal)
	got, err := e.get(context.Background(), getInput{EventID: "e1"})
	if err != nil {
		t.Fatal(err)
	}
	d := got.(Stored).Draft
	if d.ClientID != "jane" || !d.Tentative || d.FeeCents == nil || *d.FeeCents != 9500 || d.Minutes != 60 {
		t.Fatalf("draft = %+v", d)
	}
	d.Tentative, d.Minutes = false, 45
	if _, err := e.update(context.Background(), updateInput{EventID: "e1", Draft: d}); err != nil {
		t.Fatal(err)
	}

	if got := cal.events[0]; got.Title != "Janey 95" || got.End.Sub(got.Start) != 45*time.Minute {
		t.Errorf("event = %+v", got)
	}
	if got := m.SessionMap["e1"].Status; got != sessions.StatusPriced {
		t.Errorf("status = %s, want priced", got)
	}
	quiet(t, m, cal)
}

func TestUpdateFixesAnUnreadableTitle(t *testing.T) {
	m, cal := setup()
	synced(t, m, cal, ev("e1", 1, "Jnae 95 100"))

	s := m.SessionMap["e1"]
	_, err := newEditor(m, cal).update(context.Background(), updateInput{EventID: "e1", Draft: Draft{
		ClientID: "jane", Start: s.Start, FeeCents: fee(10000),
	}})
	if err != nil {
		t.Fatal(err)
	}
	if got := cal.events[0].Title; got != "Jane Smith 100" {
		t.Errorf("title = %q", got)
	}
	if got := m.SessionMap["e1"]; got.Status != sessions.StatusPriced || got.ClientID != "jane" {
		t.Errorf("session = %+v", got)
	}
}

func TestRescheduleIntoTheFuture(t *testing.T) {
	m, cal := setup()
	synced(t, m, cal, ev("e1", 1, "? Jane Smith"))

	later := now.Add(24 * time.Hour)
	_, err := newEditor(m, cal).update(context.Background(), updateInput{EventID: "e1", Draft: Draft{
		ClientID: "jane", Start: later, Tentative: true,
	}})
	if err != nil {
		t.Fatal(err)
	}

	if _, ok := m.SessionMap["e1"]; ok {
		t.Error("session kept, want it gone until the new time")
	}
	if got := m.ClientMap["jane"].NextBookedAt; got == nil || !got.Equal(later) {
		t.Errorf("NextBookedAt = %v, want %v", got, later)
	}
	quiet(t, m, cal)
}

func TestDelete(t *testing.T) {
	m, cal := setup()
	synced(t, m, cal, ev("e1", 1, "? Jane Smith"), ev("e2", 2, "Jane Smith"))

	if _, err := newEditor(m, cal).delete(context.Background(), deleteInput{EventID: "e1"}); err != nil {
		t.Fatal(err)
	}

	if cal.find("e1") >= 0 {
		t.Error("event still in the calendar")
	}
	if _, ok := m.SessionMap["e1"]; ok {
		t.Error("session still stored")
	}
	if _, ok := m.SessionMap["e2"]; !ok {
		t.Error("the other session went too")
	}
	quiet(t, m, cal)
}

func TestDeleteAlreadyGoneFromCalendar(t *testing.T) {
	m, cal := setup()
	synced(t, m, cal, ev("e1", 1, "Jane Smith"))
	cal.events = nil

	if _, err := newEditor(m, cal).delete(context.Background(), deleteInput{EventID: "e1"}); err != nil {
		t.Fatal(err)
	}
	if _, ok := m.SessionMap["e1"]; ok {
		t.Error("session still stored")
	}
}

// An event changed in Google since the last sync is not overwritten: the
// change is applied, and she decides again.
func TestEditRefusedWhenCalendarChanged(t *testing.T) {
	m, cal := setup()
	synced(t, m, cal, ev("e1", 1, "? Jane Smith"))
	cal.events[0].Title, cal.events[0].ETag = "Jane Smith 120", "2"

	_, err := newEditor(m, cal).delete(context.Background(), deleteInput{EventID: "e1"})
	if !errors.Is(err, calendar.ErrChanged) {
		t.Fatalf("err = %v, want ErrChanged", err)
	}
	if cal.find("e1") < 0 {
		t.Error("event deleted")
	}
	if got := m.SessionMap["e1"]; got.Title != "Jane Smith 120" || got.Status != sessions.StatusPriced {
		t.Errorf("session = %+v, want the calendar's latest", got)
	}
}

func TestEditRefusedWithReceipt(t *testing.T) {
	m, cal := setup()
	synced(t, m, cal, ev("e1", 1, "Jane Smith"))
	s := m.SessionMap["e1"]
	s.Document = &docref.Ref{DocumentID: "d1"}
	m.SessionMap["e1"] = s

	_, err := newEditor(m, cal).delete(context.Background(), deleteInput{EventID: "e1"})
	var appErr *apperr.Error
	if !errors.As(err, &appErr) || appErr.Code != apperr.CodeConflict || cal.find("e1") < 0 {
		t.Errorf("err = %v, want a conflict and the event kept", err)
	}
}

func TestColorFor(t *testing.T) {
	home := settings.DefaultHomeVisitColorID
	tests := []struct {
		name        string
		homeVisit   bool
		usuallyHome bool
		homeColorID string
		existing    string
		want        string
	}{
		{"usual place needs no colour", false, false, home, "", ""},
		{"usual home visit needs no colour", true, true, home, "", ""},
		{"home visit for a clinic client", true, false, home, "", home},
		{"clinic for a home client", false, true, home, "", clinicColorID},
		{"clinic colour never the home one", false, true, clinicColorID, "", altClinicColorID},
		{"her own clinic colour is kept", false, false, home, "5", "5"},
		{"a home colour is cleared for clinic", false, false, home, home, ""},
		{"a clinic colour is replaced for home", true, false, home, "5", home},
	}
	for _, tt := range tests {
		if got := colorFor(tt.homeVisit, tt.usuallyHome, tt.homeColorID, tt.existing); got != tt.want {
			t.Errorf("%s: colorFor = %q, want %q", tt.name, got, tt.want)
		}
	}
}

func TestHomeVisitIsReadBack(t *testing.T) {
	m, cal := setup()
	_, err := newEditor(m, cal).create(context.Background(), Draft{ClientID: "jane", Start: now.Add(-time.Hour), HomeVisit: true})
	if err != nil {
		t.Fatal(err)
	}
	if got := m.SessionMap[cal.events[0].ID].Location; got != sessions.LocationHome {
		t.Errorf("location = %s, want home", got)
	}
}

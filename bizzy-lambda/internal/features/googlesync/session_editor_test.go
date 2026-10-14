package googlesync

import (
	"context"
	"errors"
	"testing"
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/shared/docref"
	"bizzy-lambda/internal/testutil/fakecal"
	"bizzy-lambda/internal/testutil/memory"
)

func newEditor(m *memory.Store, cal *fakecal.Calendar) Editor {
	return Editor{
		Calendar: func(context.Context) (Calendar, error) { return cal, nil },
		Clients:  m.Clients(),
		Sessions: m.Sessions(),
		Settings: m.Settings(),
		Billing:  newReconciler(m),
		Packages: m.Packages(),
		Payments: m.Payments(),
	}
}

// synced puts events in the calendar and runs the sync, as if she had
// written them in Google.
func synced(t *testing.T, m *memory.Store, cal *fakecal.Calendar, events ...calendar.Event) {
	t.Helper()
	for _, e := range events {
		e.ETag = "1"
		cal.Live = append(cal.Live, e)
	}
	if _, err := newSyncer(m, cal).Run(context.Background(), Range{}); err != nil {
		t.Fatal(err)
	}
}

// quiet checks that a sync after the edit has nothing left to do.
func quiet(t *testing.T, m *memory.Store, cal *fakecal.Calendar) {
	t.Helper()
	m.Writes = 0
	if _, err := newSyncer(m, cal).Run(context.Background(), Range{}); err != nil {
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

	if len(cal.Live) != 1 {
		t.Fatalf("calendar = %+v, want one event", cal.Live)
	}
	event := cal.Live[0]
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

	if s := m.SessionMap[cal.Live[0].ID]; !s.Upcoming || s.Status != sessions.StatusTentative {
		t.Errorf("session = %+v, want an upcoming tentative booking", s)
	}
	if cal.Live[0].Title != "? Jane Smith" {
		t.Errorf("title = %q", cal.Live[0].Title)
	}
	if got := m.ClientMap["jane"].NextBookedAt; got == nil || !got.Equal(start) {
		t.Errorf("NextBookedAt = %v, want %v", got, start)
	}
}

func TestCreateRefusesUnknownClient(t *testing.T) {
	m, cal := setup()
	_, err := newEditor(m, cal).create(context.Background(), Draft{ClientID: "nobody", Start: now})
	var appErr *apperr.Error
	if !errors.As(err, &appErr) || appErr.Code != apperr.CodeNotFound || len(cal.Live) != 0 {
		t.Errorf("err = %v, events = %v", err, cal.Live)
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
	got, err := e.get(context.Background(), eventInput{EventID: "e1"})
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

	if got := cal.Live[0]; got.Title != "Janey 95" || got.End.Sub(got.Start) != 45*time.Minute {
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
	if got := cal.Live[0].Title; got != "Jane Smith 100" {
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

	if s := m.SessionMap["e1"]; !s.Upcoming || !s.Start.Equal(later) {
		t.Errorf("session = %+v, want booked at the new time", s)
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

	if cal.Find("e1") >= 0 {
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
	cal.Live = nil

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
	cal.Live[0].Title, cal.Live[0].ETag = "Jane Smith 120", "2"

	_, err := newEditor(m, cal).delete(context.Background(), deleteInput{EventID: "e1"})
	if !errors.Is(err, calendar.ErrChanged) {
		t.Fatalf("err = %v, want ErrChanged", err)
	}
	if cal.Find("e1") < 0 {
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
	s.Receipt = &docref.Ref{DocumentID: "d1"}
	m.SessionMap["e1"] = s

	_, err := newEditor(m, cal).delete(context.Background(), deleteInput{EventID: "e1"})
	var appErr *apperr.Error
	if !errors.As(err, &appErr) || appErr.Code != apperr.CodeConflict || cal.Find("e1") < 0 {
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
	if got := m.SessionMap[cal.Live[0].ID].Location; got != sessions.LocationHome {
		t.Errorf("location = %s, want home", got)
	}
}

func TestDeleteDropsHerData(t *testing.T) {
	m, cal := setup()
	synced(t, m, cal, ev("e1", 1, "Jane Smith"))
	s := m.SessionMap["e1"]
	s.Record = &sessions.Record{Summary: "Knee"}
	m.SessionMap["e1"] = s

	if _, err := newEditor(m, cal).delete(context.Background(), deleteInput{EventID: "e1"}); err != nil {
		t.Fatal(err)
	}
	if _, ok := m.SessionMap["e1"]; ok {
		t.Error("deleting in the app keeps nothing")
	}
}

func TestRestoreAndDiscardDeletedSessions(t *testing.T) {
	m, cal := setup()
	synced(t, m, cal, ev("e1", 1, "Jane Smith"), ev("e2", 2, "Jane Smith"))
	for _, id := range []string{"e1", "e2"} {
		s := m.SessionMap[id]
		s.Record = &sessions.Record{Summary: "Knee"}
		m.SessionMap[id] = s
	}
	// Deleted in Google Calendar, from her phone.
	cal.Trash, cal.Live = cal.Live, nil
	if _, err := newSyncer(m, cal).Run(context.Background(), Range{}); err != nil {
		t.Fatal(err)
	}
	if s := m.SessionMap["e1"]; s.RemovedAt == nil {
		t.Fatalf("e1 = %+v, want kept as deleted", s)
	}

	e := newEditor(m, cal)
	if _, err := e.restore(context.Background(), eventInput{EventID: "e1"}); err != nil {
		t.Fatal(err)
	}
	if s := m.SessionMap["e1"]; s.RemovedAt != nil || !s.Recorded() || cal.Find("e1") < 0 {
		t.Errorf("restored = %+v", s)
	}

	if _, err := e.discard(context.Background(), eventInput{EventID: "e2"}); err != nil {
		t.Fatal(err)
	}
	if _, ok := m.SessionMap["e2"]; ok {
		t.Error("discarded session kept")
	}
	quiet(t, m, cal)
}

func newFollowUpEditor(m *memory.Store, cal *fakecal.Calendar) FollowUpEditor {
	return FollowUpEditor{
		Calendar:  func(context.Context) (Calendar, error) { return cal, nil },
		Clients:   m.Clients(),
		FollowUps: m.FollowUps(),
		Location:  time.UTC,
	}
}

func TestFollowUpFromASession(t *testing.T) {
	m, cal := setup()
	e := newFollowUpEditor(m, cal)
	due := now.AddDate(0, 0, 7).Format(time.DateOnly)

	got, err := e.create(context.Background(), FollowUpDraft{
		ClientID: "jane", SessionID: "e9", Date: due, Summary: "Check  MRI results", Notes: "Left knee",
	})
	if err != nil {
		t.Fatal(err)
	}
	f := got.(followups.FollowUp)
	event := cal.Live[0]
	if event.Title != "! Jane Smith: Check MRI results" || event.Date != due || event.Description != "Left knee" || event.Private[calendar.PropSessionID] != "e9" {
		t.Errorf("event = %+v", event)
	}
	if f.ClientID != "jane" || f.SessionID != "e9" || !f.AllDay || f.Summary != "Check MRI results" {
		t.Errorf("follow-up = %+v", f)
	}

	// Rescheduled to a time; the link to the session stays on the event.
	at := now.Add(48 * time.Hour)
	if _, err := e.update(context.Background(), updateFollowUpInput{EventID: f.EventID, FollowUpDraft: FollowUpDraft{
		ClientID: "jane", Start: &at, Summary: "Check MRI results",
	}}); err != nil {
		t.Fatal(err)
	}
	if f := m.FollowUpMap[f.EventID]; f.AllDay || !f.Due.Equal(at) || f.SessionID != "e9" || f.Notes != "" {
		t.Errorf("updated = %+v", f)
	}
	quiet(t, m, cal)

	if _, err := e.delete(context.Background(), eventInput{EventID: f.EventID}); err != nil {
		t.Fatal(err)
	}
	if len(cal.Live) != 0 || len(m.FollowUpMap) != 0 {
		t.Errorf("left: events %v, follow-ups %v", cal.Live, m.FollowUpMap)
	}
}

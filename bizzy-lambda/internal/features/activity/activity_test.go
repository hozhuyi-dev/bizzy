package activity_test

import (
	"testing"
	"time"

	"bizzy-lambda/internal/features/activity"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/testutil/testapp"
)

func of(t *testing.T, a *testapp.App, clientID string) activity.View {
	t.Helper()
	var all []activity.View
	if err := a.Must("activity.list", nil, &all); err != nil {
		t.Fatal(err)
	}
	for _, v := range all {
		if v.ClientID == clientID {
			return v
		}
	}
	return activity.View{}
}

func TestWhereAClientStands(t *testing.T) {
	a := testapp.New()
	jane, err := a.Client("Jane Smith", map[string]any{"fee": map[string]any{"cents": 9000}})
	if err != nil {
		t.Fatal(err)
	}
	book := func(hours int, more map[string]any) {
		start := testapp.Epoch.Add(time.Duration(hours) * time.Hour)
		in := map[string]any{"clientId": jane, "time": map[string]any{"start": start, "end": start.Add(time.Hour)}}
		for k, v := range more {
			in[k] = v
		}
		if err := a.Must("sessions.create", in, nil); err != nil {
			t.Fatal(err)
		}
	}
	var s struct{ ID string }
	start := testapp.Epoch.Add(-48 * time.Hour)
	if err := a.Must("sessions.create", map[string]any{"clientId": jane, "time": map[string]any{"start": start, "end": start.Add(time.Hour)},
		"package": map[string]any{"bought": map[string]any{"hours": 5, "priceCents": 40000}}}, &s); err != nil {
		t.Fatal(err)
	}
	if err := a.Must("sessions.saveRecord", map[string]any{"id": s.ID, "summary": "L knee, week 2"}, nil); err != nil {
		t.Fatal(err)
	}
	book(-24, nil) // a credit, not recorded
	book(48, nil)  // booked: a credit too

	v := of(t, a, jane)
	switch {
	case v.LastSummary != "L knee, week 2":
		t.Errorf("last summary %q", v.LastSummary)
	case v.Unrecorded != 1:
		t.Errorf("unrecorded %d, want 1", v.Unrecorded)
	case v.OwedCents != 40000:
		t.Errorf("owed %d, want the package's 40000", v.OwedCents)
	case v.CreditsLeftMinutes != 2*60:
		t.Errorf("credits left %d minutes, want 2 hours", v.CreditsLeftMinutes)
	case v.NextBookedAt == nil || v.LastContactedAt == nil || !v.LastContactedAt.Equal(testapp.Epoch.Add(-23*time.Hour)):
		t.Errorf("booked %v, last contacted %v", v.NextBookedAt, v.LastContactedAt)
	}
}

func TestLapsedUntilReachedOut(t *testing.T) {
	a := testapp.New()
	jane, err := a.Client("Jane Smith", map[string]any{"fee": map[string]any{"cents": 9000}})
	if err != nil {
		t.Fatal(err)
	}
	start := testapp.Epoch.Add(-time.Hour)
	if err := a.Must("sessions.create", map[string]any{"clientId": jane, "time": map[string]any{"start": start, "end": start.Add(time.Hour)}}, nil); err != nil {
		t.Fatal(err)
	}
	if v := of(t, a, jane); v.LapsedMonths != 0 {
		t.Errorf("just seen, lapsed %d", v.LapsedMonths)
	}

	a.Now = testapp.Epoch.AddDate(0, 7, 0)
	if v := of(t, a, jane); v.LapsedMonths != 6 {
		t.Errorf("after 7 months, lapsed %d, want 6", v.LapsedMonths)
	}

	// Reaching out keeps her off for a while, through a follow-up done.
	var fu followups.View
	if err := a.Must("followUps.reachedOut", map[string]any{"clientId": jane}, &fu); err != nil {
		t.Fatal(err)
	}
	if fu.DoneAt == nil || fu.Summary != followups.ReachedOutSummary || !fu.AllDay {
		t.Errorf("reached out: %+v", fu)
	}
	// Done today, it counts from today's start, when it was due.
	if v := of(t, a, jane); v.LapsedMonths != 0 || v.LastContactedAt == nil || !v.LastContactedAt.Equal(fu.Due) {
		t.Errorf("reached out: lapsed %d, last contacted %v", v.LapsedMonths, v.LastContactedAt)
	}
	a.Now = a.Now.AddDate(0, 0, activity.ContactSnoozeDays+1)
	if v := of(t, a, jane); v.LapsedMonths != 6 {
		t.Errorf("snooze over, lapsed %d, want 6", v.LapsedMonths)
	}

	// A follow-up waiting keeps her off too.
	in := map[string]any{"clientId": jane, "when": map[string]any{"date": "2027-06-01"}, "summary": "Call"}
	if err := a.Must("followUps.create", in, nil); err != nil {
		t.Fatal(err)
	}
	if v := of(t, a, jane); v.LapsedMonths != 0 || v.OpenFollowUps != 1 || v.NextFollowUpAt == nil {
		t.Errorf("follow-up waiting: %+v", v)
	}
}

// A follow-up counts as contact when it was due, so ticking an old one off
// later doesn't make the client look recently contacted; one done early
// counts when it was done.
func TestFollowUpContactsWhenDue(t *testing.T) {
	a := testapp.New()
	jane, err := a.Client("Jane Smith", nil)
	if err != nil {
		t.Fatal(err)
	}
	create := func(date string) followups.View {
		var fu followups.View
		in := map[string]any{"clientId": jane, "when": map[string]any{"date": date}, "summary": "Call"}
		if err := a.Must("followUps.create", in, &fu); err != nil {
			t.Fatal(err)
		}
		return fu
	}
	done := func(fu followups.View) {
		if err := a.Must("followUps.setDone", map[string]any{"id": fu.ID, "done": true}, nil); err != nil {
			t.Fatal(err)
		}
	}

	late := create(testapp.Epoch.AddDate(0, 0, -20).In(testapp.KL).Format(time.DateOnly))
	done(late)
	if v := of(t, a, jane); v.LastContactedAt == nil || !v.LastContactedAt.Equal(late.Due) {
		t.Errorf("ticked late: last contacted %v, want when due, %v", v.LastContactedAt, late.Due)
	}

	early := create(testapp.Epoch.AddDate(0, 0, 10).In(testapp.KL).Format(time.DateOnly))
	done(early)
	if v := of(t, a, jane); v.LastContactedAt == nil || !v.LastContactedAt.Equal(a.Now) {
		t.Errorf("done early: last contacted %v, want when done, %v", v.LastContactedAt, a.Now)
	}
}

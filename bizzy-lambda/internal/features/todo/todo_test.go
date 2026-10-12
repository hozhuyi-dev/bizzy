package todo

import (
	"testing"
	"time"

	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/sessions"
)

func TestBuildMergesByWhen(t *testing.T) {
	now := time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC)
	fee := int64(9500)
	at := func(hours int) time.Time { return now.Add(time.Duration(hours) * time.Hour) }

	open := []sessions.Session{
		// Happened yesterday: record and collect.
		{EventID: "past", Start: at(-24), End: at(-23), Status: sessions.StatusPriced, FeeCents: &fee},
		// Tentative tomorrow: confirm.
		{EventID: "maybe", Start: at(24), End: at(25), Status: sessions.StatusTentative},
		// Booked tomorrow: in the index, nothing to do yet.
		{EventID: "booked", Start: at(26), End: at(27), Status: sessions.StatusPriced, FeeCents: &fee},
	}
	done := now
	due := []followups.FollowUp{
		{EventID: "call", Due: at(2)},
		{EventID: "done", Due: at(1), DoneAt: &done},
	}

	items := Build(open, due, now)
	var got []string
	for _, item := range items {
		if item.Session != nil {
			got = append(got, item.Session.EventID)
		} else {
			got = append(got, item.FollowUp.EventID)
		}
	}
	want := []string{"past", "call", "maybe"}
	if len(got) != len(want) {
		t.Fatalf("items = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("items = %v, want %v", got, want)
		}
	}
	if r := items[0].Reasons; len(r) != 2 || r[0] != sessions.ReasonRecord || r[1] != sessions.ReasonCollect {
		t.Errorf("reasons = %v", r)
	}
}

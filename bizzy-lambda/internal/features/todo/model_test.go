package todo

import (
	"testing"
	"time"

	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/money"
	"bizzy-lambda/internal/features/packages"
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
		{EventID: "maybe", Start: at(24), End: at(25), Status: sessions.StatusTentative, ClientID: "jane"},
		// Booked tomorrow: in the index, nothing to do yet.
		{EventID: "booked", Start: at(26), End: at(27), Status: sessions.StatusPriced, FeeCents: &fee},
	}
	done := now
	due := []followups.FollowUp{
		{EventID: "call", Due: at(2)},
		{EventID: "done", Due: at(1), DoneAt: &done},
		// No client has the name: fix.
		{EventID: "who", Due: at(3), Problem: "No client has this name"},
	}

	unpaid := []packages.Package{
		// Bought in the app this morning, unpaid: collect.
		{ID: "app", Source: packages.SourceApp, PriceCents: 85000, PurchasedAt: at(-3)},
		// Bought in a session: collected on that session instead.
		{ID: "past", Source: packages.SourceCalendar, PriceCents: 85000, PurchasedAt: at(-24)},
		// Paid, with credits left: in the index, nothing to do.
		{ID: "paid", Source: packages.SourceApp, PriceCents: 85000, Sessions: 10, PurchasedAt: at(-2), Payment: &money.Payment{Status: money.Paid}},
	}

	items := Build(open, unpaid, due, now)
	var got []string
	for _, item := range items {
		switch {
		case item.Session != nil:
			got = append(got, item.Session.EventID)
		case item.Package != nil:
			got = append(got, "package "+item.Package.ID)
		default:
			got = append(got, item.FollowUp.EventID)
		}
	}
	want := []string{"past", "package app", "call", "who", "maybe"}
	if len(got) != len(want) {
		t.Fatalf("items = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("items = %v, want %v", got, want)
		}
	}
	if r := items[1].Reasons; len(r) != 1 || r[0] != sessions.ReasonCollect {
		t.Errorf("package reasons = %v", r)
	}
	if r := items[0].Reasons; len(r) != 2 || r[0] != sessions.ReasonRecord || r[1] != sessions.ReasonCollect {
		t.Errorf("reasons = %v", r)
	}
	if r := items[2].Reasons; len(r) != 0 {
		t.Errorf("follow-up reasons = %v, want none", r)
	}
	if r := items[3].Reasons; len(r) != 1 || r[0] != sessions.ReasonFix {
		t.Errorf("unmatched follow-up reasons = %v, want fix", r)
	}
}

package app

import (
	"testing"
	"time"

	"bizzy-lambda/internal/features/activity"
	"bizzy-lambda/internal/features/expenses"
)

func TestInsightsOfAYear(t *testing.T) {
	now := time.Date(2026, time.March, 15, 10, 0, 0, 0, time.UTC)
	clients := []activity.Client{
		{ClientID: "jane", CreditsLeftMinutes: 90, CreditsLeftCents: 12000, Months: map[string]activity.Month{
			"2025-02": {Sessions: 2, ReceivedCents: 18000},
			"2025-06": {Sessions: 1, ReceivedCents: 9000}, // after the months compared
			"2026-02": {Sessions: 3, ReceivedCents: 40000},
		}},
		{ClientID: "ali", Months: map[string]activity.Month{
			"2026-03": {Sessions: 2, ReceivedCents: 18000},
		}},
		{ClientID: "old", Months: map[string]activity.Month{"2023-01": {ReceivedCents: 5000}}},
	}
	spent := expenses.Spending{
		ByMonth:    map[string]int64{"2026-01": 2500, "2026-03": 1000},
		ByCategory: map[string]int64{"purchases": 3500},
	}

	v := insightsOf(clients, spent, 2026, now)
	want := []InsightsMonth{
		{Month: "2026-01", SpentCents: 2500},
		{Month: "2026-02", ReceivedCents: 40000, Sessions: 3},
		{Month: "2026-03", ReceivedCents: 18000, SpentCents: 1000, Sessions: 2, NewSessions: 2},
	}
	if len(v.Months) != len(want) {
		t.Fatalf("months %+v, want to March", v.Months)
	}
	for i, m := range want {
		if v.Months[i] != m {
			t.Errorf("month %d: %+v, want %+v", i, v.Months[i], m)
		}
	}
	switch {
	case v.PreviousReceivedCents != 18000:
		t.Errorf("previous received %d, want January to March 2025's 18000", v.PreviousReceivedCents)
	case v.PrepaidMinutes != 90 || v.PrepaidCents != 12000:
		t.Errorf("prepaid %d min, %d cents", v.PrepaidMinutes, v.PrepaidCents)
	case len(v.Years) != 3 || v.Years[0] != 2026 || v.Years[2] != 2023:
		t.Errorf("years %v, want 2026, 2025, 2023", v.Years)
	case v.SpentByCategory["purchases"] != 3500:
		t.Errorf("by category %v", v.SpentByCategory)
	}

	past := insightsOf(clients, expenses.Spending{}, 2025, now)
	if len(past.Months) != 12 || past.Months[1].NewSessions != 2 || past.Months[5].NewSessions != 0 {
		t.Errorf("2025: %+v", past.Months)
	}
}

package billing

import (
	"context"
	"testing"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/shared/money"
	"bizzy-lambda/internal/testutil/memory"
)

// A new fee from a day reprices the sessions from that day on (in her time
// zone) and leaves the earlier ones alone; the impact lists exactly those,
// and asks to confirm because one of them is paid.
func TestFeeRatesFromADay(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	sync(t, m,
		event("e1", 1, "Jane Smith"),
		// 2 a.m. UTC on the 5th is the 5th in Kuala Lumpur.
		event("e5", 5, "Jane Smith"),
		event("e6", 6, "Jane Smith"),
		event("e7", 7, "Jane Smith 95"),
	)
	edit(m, "e6", func(s *sessions.Session) {
		s.Payment = &money.Payment{Status: money.Paid, Method: money.MethodCash, AmountCents: 9000, DueCents: 9000, PaidOn: "2026-10-06"}
	})

	rates := []clients.FeeRate{{Cents: 9000}, {From: "2026-10-05", Cents: 10000}}
	impact, err := newReconciler(m).FeeImpact(context.Background(), FeeImpactInput{ClientID: "jane", FeeRates: rates})
	if err != nil {
		t.Fatalf("FeeImpact: %v", err)
	}
	var ids []string
	for _, c := range impact.Changes {
		ids = append(ids, c.EventID)
		if *c.BeforeCents != 9000 || *c.AfterCents != 10000 {
			t.Errorf("%s: %d → %d, want 9000 → 10000", c.EventID, *c.BeforeCents, *c.AfterCents)
		}
	}
	if len(ids) != 2 || ids[0] != "e5" || ids[1] != "e6" {
		t.Errorf("changes = %v, want e5 and e6", ids)
	}
	if !impact.NeedsConfirm || !impact.Changes[1].Paid {
		t.Errorf("impact = %+v, want e6 paid and a confirmation", impact)
	}

	c := m.ClientMap["jane"]
	c.FeeRates = rates
	m.ClientMap["jane"] = c
	reconcile(t, m, Scope{ClientIDs: []string{"jane"}})
	for id, want := range map[string]int64{"e1": 9000, "e5": 10000, "e6": 10000, "e7": 9500} {
		if got := m.SessionMap[id].DueCents(); got != want {
			t.Errorf("%s fee = %d, want %d", id, got, want)
		}
	}
}

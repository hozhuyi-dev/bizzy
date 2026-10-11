package billing

import (
	"context"
	"testing"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/docref"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/testutil/memory"
)

var kl = time.FixedZone("MYT", 8*60*60)

func day(d int) time.Time {
	return time.Date(2026, 10, d, 2, 0, 0, 0, time.UTC)
}

func cents(v int64) *int64 { return &v }

func newReconciler(m *memory.Store) *Reconciler {
	return &Reconciler{
		Clients:  m.Clients(),
		Sessions: m.Sessions(),
		Packages: m.Packages(),
		Settings: m.Settings(),
		Location: kl,
	}
}

// sync simulates the calendar sync writing new events, then reconciling.
func sync(t *testing.T, m *memory.Store, events ...sessions.Session) {
	t.Helper()
	var changes []Change
	for _, e := range events {
		after := e
		var before *sessions.Session
		if stored, ok := m.SessionMap[e.EventID]; ok {
			before = &stored
			after.Ignored, after.Document = stored.Ignored, stored.Document
		}
		changes = append(changes, Change{Before: before, After: &after})
	}
	if _, err := newReconciler(m).Reconcile(context.Background(), Scope{Changes: changes}); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
}

func event(id string, d int, title string) sessions.Session {
	return sessions.Session{EventID: id, Title: title, Start: day(d), End: day(d).Add(time.Hour)}
}

func jane() clients.Client {
	return clients.Client{ID: "jane", Name: "Jane Smith", Aliases: []string{"jane smith"}, DefaultFeeCents: cents(9000)}
}

func TestPricing(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()

	sync(t, m,
		event("e1", 1, "Jane Smith"),          // default fee
		event("e2", 2, "Jane Smith 95"),       // title amount
		event("e3", 3, "Jane Smith 3@250"),    // buys package, uses credit 1
		event("e4", 4, "Jane Smith"),          // credit 2
		event("e5", 5, "Jane Smith 120"),      // title amount wins over credit
		event("e6", 6, "Jane Smith"),          // credit 3
		event("e7", 7, "Jane Smith"),          // credits used up: default fee
		event("e8", 8, "? Jane Smith"),        // tentative
		event("e9", 9, "Jnae Smith"),          // near miss
		event("e10", 10, "Jane Smith 95 100"), // parse error
	)

	tests := []struct {
		id         string
		status     sessions.Status
		fee        int64
		packageID  string
		valueCents int64
	}{
		{"e1", sessions.StatusPriced, 9000, "", 9000},
		{"e2", sessions.StatusPriced, 9500, "", 9500},
		{"e3", sessions.StatusPackage, 0, "e3", 8334},
		{"e4", sessions.StatusPackage, 0, "e3", 8333},
		{"e5", sessions.StatusPriced, 12000, "", 12000},
		{"e6", sessions.StatusPackage, 0, "e3", 8333},
		{"e7", sessions.StatusPriced, 9000, "", 9000},
		{"e8", sessions.StatusTentative, 0, "", 0},
		{"e9", sessions.StatusUnmatched, 0, "", 0},
		{"e10", sessions.StatusParseError, 0, "", 0},
	}
	for _, tt := range tests {
		s := m.SessionMap[tt.id]
		var fee int64
		if s.FeeCents != nil {
			fee = *s.FeeCents
		}
		if s.Status != tt.status || fee != tt.fee || s.PackageID != tt.packageID || s.ValueCents != tt.valueCents {
			t.Errorf("%s = {%s fee:%d pkg:%q value:%d}, want {%s fee:%d pkg:%q value:%d}",
				tt.id, s.Status, fee, s.PackageID, s.ValueCents, tt.status, tt.fee, tt.packageID, tt.valueCents)
		}
	}

	if s := m.SessionMap["e9"]; s.SuggestedClientID != "jane" {
		t.Errorf("near miss suggestion = %q", s.SuggestedClientID)
	}

	p := m.PackageMap["e3"]
	if p.ClientID != "jane" || p.Sessions != 3 || p.PriceCents != 25000 || p.CreditsUsed != 3 || p.Source != packages.SourceCalendar {
		t.Errorf("package = %+v", p)
	}

	a := m.ClientMap["jane"].Activity["2026-10"]
	// Delivered: e1..e7. Received: 90+95+250+120+90 = 645. Earned: 90+95+250+120+90 = 645.
	if a.Sessions != 7 || a.ReceivedCents != 64500 || a.EarnedCents != 64500 {
		t.Errorf("activity = %+v", a)
	}
}

func TestQuietRunWritesNothing(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	sync(t, m, event("e1", 1, "Jane Smith 10x85"), event("e2", 2, "Jane Smith"))

	m.Writes = 0
	sync(t, m, event("e1", 1, "Jane Smith 10x85"), event("e2", 2, "Jane Smith"))
	if m.Writes != 0 {
		t.Errorf("unchanged calendar caused %d writes", m.Writes)
	}
}

func TestPackageRemovedFromTitle(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	sync(t, m, event("e1", 1, "Jane Smith 10x85"), event("e2", 2, "Jane Smith"))

	sync(t, m, event("e1", 1, "Jane Smith"))

	if _, ok := m.PackageMap["e1"]; ok {
		t.Error("package should be deleted once the title no longer buys it")
	}
	if s := m.SessionMap["e2"]; s.Status != sessions.StatusPriced || s.FeeSource != sessions.FeeFromDefault {
		t.Errorf("e2 = %s/%s, want priced from default", s.Status, s.FeeSource)
	}
}

func TestReceiptedPackageIsKeptAsRemoved(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	sync(t, m, event("e1", 1, "Jane Smith 10x85"))

	p := m.PackageMap["e1"]
	p.Document = &docref.Ref{DocumentID: "d1", Number: "RCP-0001", AmountCents: cents(85000), ClientID: "jane"}
	m.PackageMap["e1"] = p

	sync(t, m, event("e1", 1, "Jane Smith"))

	p = m.PackageMap["e1"]
	if !p.Removed || p.Drift == "" {
		t.Errorf("package = removed:%v drift:%q, want removed with drift", p.Removed, p.Drift)
	}
}

func TestLinkingAnAliasMatchesUnmatchedSessions(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	sync(t, m, event("e1", 1, "Bob Lee 120"))
	if m.SessionMap["e1"].Status != sessions.StatusUnmatched {
		t.Fatalf("status = %s, want unmatched", m.SessionMap["e1"].Status)
	}

	m.ClientMap["bob"] = clients.Client{ID: "bob", Name: "Bob Lee", Aliases: []string{"bob lee"}}
	if _, err := newReconciler(m).Reconcile(context.Background(), Scope{ClientIDs: []string{"bob"}, Unmatched: true}); err != nil {
		t.Fatal(err)
	}

	s := m.SessionMap["e1"]
	if s.Status != sessions.StatusPriced || s.ClientID != "bob" || s.Open() {
		t.Errorf("session = %s client:%q open:%v", s.Status, s.ClientID, s.Open())
	}
	if a := m.ClientMap["bob"].Activity["2026-10"]; a.Sessions != 1 || a.ReceivedCents != 12000 {
		t.Errorf("bob activity = %+v", a)
	}
}

func TestMissingFeeIsOpen(t *testing.T) {
	m := memory.New()
	m.ClientMap["ann"] = clients.Client{ID: "ann", Name: "Ann", Aliases: []string{"ann"}}
	sync(t, m, event("e1", 1, "Ann"))

	s := m.SessionMap["e1"]
	if s.Status != sessions.StatusMissingFee || !s.Open() {
		t.Errorf("session = %s open:%v", s.Status, s.Open())
	}
}

func TestLocation(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	home := jane()
	home.ID, home.Name, home.Aliases, home.HomeVisits = "hal", "Hal", []string{"hal"}, true
	m.ClientMap["hal"] = home

	tomato := event("e1", 1, "Jane Smith")
	tomato.ColorID = "11"
	other := event("e2", 2, "Hal")
	other.ColorID = "2"

	sync(t, m, tomato, other, event("e3", 3, "Hal"), event("e4", 4, "Jane Smith"))

	want := map[string]sessions.Location{"e1": "home", "e2": "clinic", "e3": "home", "e4": "clinic"}
	for id, loc := range want {
		if got := m.SessionMap[id].Location; got != loc {
			t.Errorf("%s location = %s, want %s", id, got, loc)
		}
	}
}

func TestDriftAfterReceipt(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	sync(t, m, event("e1", 1, "Jane Smith 95"))

	s := m.SessionMap["e1"]
	s.Document = &docref.Ref{DocumentID: "d1", Number: "RCP-0001", AmountCents: cents(9500), Date: "2026-10-01", ClientID: "jane"}
	m.SessionMap["e1"] = s

	sync(t, m, event("e1", 3, "Jane Smith 95"))

	s = m.SessionMap["e1"]
	if s.Drift == "" || !s.Open() {
		t.Errorf("drift = %q open:%v, want a drift on the to-do list", s.Drift, s.Open())
	}
}

func TestPackageShares(t *testing.T) {
	p := packages.Package{Sessions: 3, PriceCents: 25000}
	total := p.ShareCents(0) + p.ShareCents(1) + p.ShareCents(2)
	if total != 25000 {
		t.Errorf("shares add up to %d, want 25000", total)
	}
}

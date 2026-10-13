package billing

import (
	"context"
	"testing"
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/docref"
	"bizzy-lambda/internal/features/money"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/testutil/memory"
)

var kl = time.FixedZone("MYT", 8*60*60)

func day(d int) time.Time {
	return time.Date(2026, 10, d, 2, 0, 0, 0, time.UTC)
}

func cents(v int64) *int64 { return &v }

// today is the reconcile's now unless a test moves it: after the October
// days the tests book.
var today = day(20)

func newReconciler(m *memory.Store) *Reconciler {
	return &Reconciler{
		Clients:  m.Clients(),
		Sessions: m.Sessions(),
		Packages: m.Packages(),
		Settings: m.Settings(),
		Location: kl,
		Now:      func() time.Time { return today },
	}
}

// sync simulates the calendar sync passing events to the reconcile.
func sync(t *testing.T, m *memory.Store, events ...calendar.Event) {
	t.Helper()
	var changes []Change
	for _, e := range events {
		changes = append(changes, Change{EventID: e.ID, Event: &e})
	}
	reconcile(t, m, Scope{Changes: changes})
}

// gone simulates the event leaving the calendar.
func gone(t *testing.T, m *memory.Store, id string, discard bool) {
	t.Helper()
	reconcile(t, m, Scope{Changes: []Change{{EventID: id, Discard: discard}}})
}

func reconcile(t *testing.T, m *memory.Store, scope Scope) {
	t.Helper()
	if _, err := newReconciler(m).Reconcile(context.Background(), scope); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
}

func event(id string, d int, title string) calendar.Event {
	return calendar.Event{ID: id, Title: title, Start: day(d), End: day(d).Add(time.Hour)}
}

// edit changes a stored session as her actions would, keeping its version.
func edit(m *memory.Store, id string, change func(*sessions.Session)) {
	s := m.SessionMap[id]
	change(&s)
	m.SessionMap[id] = s
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
	// The package is collected with the session that bought it, but due on
	// its own: the session's own fee is a credit.
	if s := m.SessionMap["e3"]; s.BoughtCents != 25000 || s.DueCents() != 0 || !s.BoughtDue() {
		t.Errorf("e3 bought %d due %d package due %v, want the package due", s.BoughtCents, s.DueCents(), s.BoughtDue())
	}

	p := m.PackageMap["e3"]
	if p.ClientID != "jane" || p.Sessions != 3 || p.PriceCents != 25000 || p.CreditsUsed != 3 || p.Source != packages.SourceCalendar {
		t.Errorf("package = %+v", p)
	}

	a := m.ClientMap["jane"].Activity["2026-10"]
	// Delivered: e1..e7, earning 90+95+250+120+90 = 645. Nothing is paid yet.
	if a.Sessions != 7 || a.EarnedCents != 64500 || a.ReceivedCents != 0 {
		t.Errorf("activity = %+v", a)
	}
}

func TestPaymentsAreReceivedWhenPaid(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	sync(t, m, event("e1", 1, "Jane Smith 95 10x85"))

	edit(m, "e1", func(s *sessions.Session) {
		s.Payment = &money.Payment{Status: money.Paid, Method: money.MethodTNG, AmountCents: 9500, PaidOn: "2026-10-01"}
	})
	reconcile(t, m, Scope{ClientIDs: []string{"jane"}})
	if s := m.SessionMap["e1"]; s.Paid() || !s.BoughtDue() {
		t.Errorf("fee paid, package not: paid %v package due %v", s.Paid(), s.BoughtDue())
	}

	p := m.PackageMap["e1"]
	p.Payment = &money.Payment{Status: money.Paid, Method: money.MethodCash, AmountCents: 85000, PaidOn: "2026-11-02"}
	m.PackageMap["e1"] = p
	reconcile(t, m, Scope{ClientIDs: []string{"jane"}})

	if s := m.SessionMap["e1"]; !s.BoughtSettled || !s.Paid() {
		t.Errorf("both paid: settled %v paid %v", s.BoughtSettled, s.Paid())
	}
	activity := m.ClientMap["jane"].Activity
	if got := activity["2026-10"]; got.ReceivedCents != 9500 || got.Sessions != 1 {
		t.Errorf("October = %+v, want the session and its fee", got)
	}
	if got := activity["2026-11"].ReceivedCents; got != 85000 {
		t.Errorf("November received = %d, want the package", got)
	}
	// Paid at its fee, it keeps the fee rather than take a credit.
	if s := m.SessionMap["e1"]; s.Status != sessions.StatusPriced {
		t.Errorf("status = %s", s.Status)
	}
}

func TestAppPackageIsReceivedWhenPaidNotBought(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	m.PackageMap["p"] = packages.Package{ID: "p", ClientID: "jane", Sessions: 5, PriceCents: 40000, PurchasedAt: day(1), Source: packages.SourceApp}
	reconcile(t, m, Scope{ClientIDs: []string{"jane"}})

	if a := m.ClientMap["jane"].Activity; a != nil {
		t.Errorf("activity = %v, want nothing received before she is paid", a)
	}
	if p := m.PackageMap["p"]; !p.Open() || !p.CollectOnItsOwn() {
		t.Error("an unpaid app package is collected on its own")
	}
}

func TestBookingsBecomeSessionsOnceHappened(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	sync(t, m, event("e1", 25, "Jane Smith"), event("e2", 28, "Jane Smith"))

	s := m.SessionMap["e1"]
	if !s.Upcoming || s.Status != sessions.StatusPriced || len(s.Todo(today)) != 0 {
		t.Errorf("booking = upcoming %v status %s todo %v", s.Upcoming, s.Status, s.Todo(today))
	}
	c := m.ClientMap["jane"]
	if c.NextBookedAt == nil || !c.NextBookedAt.Equal(day(25)) || c.Activity != nil {
		t.Errorf("client next %v activity %v, want booked with nothing delivered", c.NextBookedAt, c.Activity)
	}

	today = day(26)
	t.Cleanup(func() { today = day(20) })
	sync(t, m, event("e1", 25, "Jane Smith"))

	if s := m.SessionMap["e1"]; s.Upcoming {
		t.Error("e1 has happened")
	}
	c = m.ClientMap["jane"]
	if c.Activity["2026-10"].Sessions != 1 || !c.NextBookedAt.Equal(day(28)) || !c.LastSessionAt.Equal(day(25)) {
		t.Errorf("client = activity %v next %v last %v", c.Activity, c.NextBookedAt, c.LastSessionAt)
	}
}

func TestConfirmedAt(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	sync(t, m, event("e1", 25, "? Jane Smith"), event("e2", 1, "Jane Smith"))

	if s := m.SessionMap["e1"]; s.ConfirmedAt != nil {
		t.Errorf("tentative confirmed at %v", s.ConfirmedAt)
	}
	// History counts as confirmed when it happened.
	if s := m.SessionMap["e2"]; s.ConfirmedAt == nil || !s.ConfirmedAt.Equal(day(1)) {
		t.Errorf("history confirmed at %v, want its start", s.ConfirmedAt)
	}

	sync(t, m, event("e1", 25, "Jane Smith"))
	if s := m.SessionMap["e1"]; s.ConfirmedAt == nil || !s.ConfirmedAt.Equal(today) {
		t.Errorf("confirmed at %v, want now", s.ConfirmedAt)
	}
}

func TestDeletedSessionKeepsHerData(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	sync(t, m, event("e1", 1, "Jane Smith"), event("e2", 2, "Jane Smith"))
	edit(m, "e1", func(s *sessions.Session) { s.Record = &sessions.Record{Summary: "Knee"} })
	m.NotesMap["e1"] = sessions.Notes{EventID: "e1", Text: "long notes"}

	gone(t, m, "e1", false)
	gone(t, m, "e2", false)

	s, kept := m.SessionMap["e1"]
	if !kept || s.RemovedAt == nil || s.Status != sessions.StatusRemoved || s.Todo(today)[0] != sessions.ReasonDeleted {
		t.Fatalf("e1 = %+v, want kept as deleted", s)
	}
	if _, ok := m.SessionMap["e2"]; ok {
		t.Error("e2 had nothing of hers and should be gone")
	}
	if a := m.ClientMap["jane"].Activity; a != nil {
		t.Errorf("activity = %v, want none from deleted sessions", a)
	}

	// The event is back: restored as it was.
	sync(t, m, event("e1", 1, "Jane Smith"))
	if s := m.SessionMap["e1"]; s.RemovedAt != nil || s.Status != sessions.StatusPriced || !s.Recorded() {
		t.Errorf("restored = %+v", s)
	}

	// Deleted in the app: her data goes too.
	gone(t, m, "e1", true)
	if _, ok := m.SessionMap["e1"]; ok {
		t.Error("discarded session kept")
	}
	if _, ok := m.NotesMap["e1"]; ok {
		t.Error("discarded session's notes kept")
	}
}

func TestQuietRunWritesNothing(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	sync(t, m, event("e1", 1, "Jane Smith 10x85"), event("e2", 2, "Jane Smith"), event("e3", 25, "? Jane Smith"))

	m.Writes = 0
	sync(t, m, event("e1", 1, "Jane Smith 10x85"), event("e2", 2, "Jane Smith"), event("e3", 25, "? Jane Smith"))
	if m.Writes != 0 {
		t.Errorf("unchanged calendar caused %d writes", m.Writes)
	}
}

func TestPackageRemovedFromTitleIsUnlinked(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	sync(t, m, event("e1", 1, "Jane Smith 10x85"), event("e2", 2, "Jane Smith"))

	p := m.PackageMap["e1"]
	p.Receipt = &docref.Ref{DocumentID: "d1", Number: "RCP260001", AmountCents: cents(85000), ClientID: "jane"}
	p.Payment = &money.Payment{Status: money.Paid, Method: money.MethodCash, AmountCents: 85000, PaidOn: "2026-10-01"}
	m.PackageMap["e1"] = p

	sync(t, m, event("e1", 1, "Jane Smith"))

	// Kept as an app package, with everything she recorded, until she
	// deletes it herself.
	p, ok := m.PackageMap["e1"]
	if !ok || p.Source != packages.SourceApp || p.Payment == nil || p.Receipt == nil || p.CreditsUsed != 2 {
		t.Fatalf("package = %+v, want unlinked and kept", p)
	}
	// e1 buys nothing now, but the package dates from it: its first credit.
	if s := m.SessionMap["e1"]; s.BoughtCents != 0 || s.Status != sessions.StatusPackage || s.PackageID != "e1" {
		t.Errorf("e1 = %s/%q bought %d, want on the first credit, buying nothing", s.Status, s.PackageID, s.BoughtCents)
	}
	if s := m.SessionMap["e2"]; s.Status != sessions.StatusPackage || s.PackageID != "e1" {
		t.Errorf("e2 = %s/%q, want still on the package's credit", s.Status, s.PackageID)
	}

	// The title buys it again: linked back, not bought twice.
	sync(t, m, event("e1", 1, "Jane Smith 10x85"))
	if p := m.PackageMap["e1"]; p.Source != packages.SourceCalendar || p.Payment == nil || len(m.PackageMap) != 1 {
		t.Errorf("package = %+v, want linked back with its payment", p)
	}
	if s := m.SessionMap["e1"]; !s.BoughtSettled {
		t.Error("the session mirrors its package's payment")
	}
}

func TestUnpaidUnlinkedPackageIsCollectedOnItsOwn(t *testing.T) {
	m := memory.New()
	m.ClientMap["jane"] = jane()
	sync(t, m, event("e1", 1, "Jane Smith 10x85"))
	if p := m.PackageMap["e1"]; p.CollectOnItsOwn() {
		t.Error("a linked package is collected on its session")
	}

	sync(t, m, event("e1", 1, "Jane Smith"))
	if p := m.PackageMap["e1"]; !p.CollectOnItsOwn() {
		t.Errorf("package = %+v, want collected on its own once unlinked", p)
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
	reconcile(t, m, Scope{ClientIDs: []string{"bob"}, Unmatched: true})

	s := m.SessionMap["e1"]
	if s.Status != sessions.StatusPriced || s.ClientID != "bob" || s.Todo(today)[0] != sessions.ReasonRecord {
		t.Errorf("session = %s client:%q todo:%v", s.Status, s.ClientID, s.Todo(today))
	}
	if a := m.ClientMap["bob"].Activity["2026-10"]; a.Sessions != 1 || a.EarnedCents != 12000 {
		t.Errorf("bob activity = %+v", a)
	}
}

func TestMissingFeeIsOpen(t *testing.T) {
	m := memory.New()
	m.ClientMap["ann"] = clients.Client{ID: "ann", Name: "Ann", Aliases: []string{"ann"}}
	sync(t, m, event("e1", 1, "Ann"))

	s := m.SessionMap["e1"]
	if s.Status != sessions.StatusMissingFee || !s.Open() || s.Todo(today)[0] != sessions.ReasonFix {
		t.Errorf("session = %s open:%v todo:%v", s.Status, s.Open(), s.Todo(today))
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

	edit(m, "e1", func(s *sessions.Session) {
		s.Receipt = &docref.Ref{DocumentID: "d1", Number: "RCP260001", AmountCents: cents(9500), Date: "2026-10-01", ClientID: "jane"}
	})

	sync(t, m, event("e1", 3, "Jane Smith 95"))

	s := m.SessionMap["e1"]
	if s.Drift == "" || s.Todo(today)[0] != sessions.ReasonFix {
		t.Errorf("drift = %q todo:%v, want a drift on the to-do list", s.Drift, s.Todo(today))
	}
}

func TestPackageShares(t *testing.T) {
	p := packages.Package{Sessions: 3, PriceCents: 25000}
	total := p.ShareCents(0) + p.ShareCents(1) + p.ShareCents(2)
	if total != 25000 {
		t.Errorf("shares add up to %d, want 25000", total)
	}
}

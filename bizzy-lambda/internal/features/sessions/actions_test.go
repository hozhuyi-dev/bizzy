package sessions_test

import (
	"testing"
	"time"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/testutil/testapp"
)

// setup is the app with Jane (usual fee RM 90) and Bob (no usual fee).
func setup(t *testing.T) (a *testapp.App, jane, bob string) {
	t.Helper()
	a = testapp.New()
	var err error
	if jane, err = a.Client("Jane Smith", map[string]any{"feeRates": []map[string]any{{"cents": 9000}}}); err != nil {
		t.Fatal(err)
	}
	if bob, err = a.Client("Bob Lee", nil); err != nil {
		t.Fatal(err)
	}
	return a, jane, bob
}

func at(hour int) time.Time { return testapp.Epoch.Add(time.Duration(hour) * time.Hour) }

func book(clientID string, from, to int, more map[string]any) map[string]any {
	in := map[string]any{"clientId": clientID, "time": map[string]any{"start": at(from), "end": at(to)}}
	for k, v := range more {
		in[k] = v
	}
	return in
}

func fee(cents int64) map[string]any { return map[string]any{"fee": map[string]any{"cents": cents}} }

func create(t *testing.T, a *testapp.App, in map[string]any) sessions.View {
	t.Helper()
	var v sessions.View
	if err := a.Must("sessions.create", in, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func refusal(t *testing.T, a *testapp.App, action string, in any) *apperr.Remedy {
	t.Helper()
	before := string(a.Table.Dump())
	_, refused, err := a.Call(action, in)
	switch {
	case err != nil:
		t.Fatal(err)
	case refused == nil || refused.Code != apperr.CodeRefused:
		t.Fatalf("%s: refused = %+v, want a refusal", action, refused)
	case string(a.Table.Dump()) != before:
		t.Fatalf("%s was refused but wrote", action)
	}
	if len(refused.Remedies) == 0 {
		return nil
	}
	return &refused.Remedies[0]
}

func TestBookingOverAnotherSessionIsRefused(t *testing.T) {
	a, jane, bob := setup(t)
	janes := create(t, a, book(jane, 2, 3, nil))
	if r := refusal(t, a, "sessions.create", book(bob, 2, 4, fee(5000))); r == nil || r.Action != "sessions.update" || r.Target != janes.ID {
		t.Errorf("remedy = %+v, want moving Jane's session", r)
	}
	create(t, a, book(bob, 3, 4, fee(5000))) // Right after it is fine.
}

func TestWhatPaysForASession(t *testing.T) {
	a, jane, bob := setup(t)

	// The usual fee, on a draft invoice of its own.
	s := create(t, a, book(jane, 2, 3, nil))
	if s.FeeCents != 9000 || s.FeeTyped || s.Invoice == nil || s.Invoice.Number != "" {
		t.Errorf("usual fee: %+v", s)
	}
	// A fee typed for it.
	if s = create(t, a, book(jane, 4, 5, fee(12000))); s.FeeCents != 12000 || !s.FeeTyped {
		t.Errorf("typed fee: %+v", s)
	}
	// Nothing pays for Bob's: refused, with what would.
	if r := refusal(t, a, "sessions.create", book(bob, 6, 7, nil)); r == nil || r.Action != "clients.update" {
		t.Errorf("remedy = %+v, want setting Bob's usual fee", r)
	}
	// A package bought in a session: its first credit pays for it, then
	// the next sessions', then the usual fee again.
	s = create(t, a, book(jane, 8, 9, map[string]any{"package": map[string]any{"bought": map[string]any{"hours": 2, "priceCents": 16000}}}))
	if len(s.Credits) != 1 || s.Bought == nil || s.Bought.PriceCents != 16000 || s.FeeCents != 0 || s.OwedCents != 16000 {
		t.Errorf("bought in it: %+v", s)
	}
	if next := create(t, a, book(jane, 10, 11, nil)); len(next.Credits) != 1 || next.Credits[0].PackageID != s.Credits[0].PackageID {
		t.Errorf("second credit: %+v", next)
	}
	if third := create(t, a, book(jane, 12, 13, nil)); len(third.Credits) != 0 || third.FeeCents != 9000 {
		t.Errorf("credits used up: %+v", third)
	}
}

func bookMinutes(clientID string, from, to int) map[string]any {
	start := testapp.Epoch.Add(time.Duration(from) * time.Minute)
	return map[string]any{"clientId": clientID, "time": map[string]any{"start": start, "end": start.Add(time.Duration(to-from) * time.Minute)}}
}

func buyPackage(t *testing.T, a *testapp.App, clientID string, hours int) string {
	t.Helper()
	var p struct{ ID string }
	in := map[string]any{"clientId": clientID, "hours": hours, "priceCents": int64(hours) * 8500, "purchasedAt": testapp.Epoch}
	if err := a.Must("packages.create", in, &p); err != nil {
		t.Fatal(err)
	}
	return p.ID
}

func TestChargedByTheHalfHour(t *testing.T) {
	a, jane, _ := setup(t)
	start := 120
	for _, c := range []struct {
		minutes int
		hours   float64
		fee     int64
	}{
		{60, 1, 9000},
		{80, 1, 9000},   // Rounded down,
		{50, 0.5, 4500}, // to the half hour,
		{20, 0.5, 4500}, // and at least one.
		{90, 1.5, 13500},
	} {
		s := create(t, a, bookMinutes(jane, start, start+c.minutes))
		if s.Hours != c.hours || s.FeeCents != c.fee || s.FeeTyped {
			t.Errorf("%d minutes: %v h for %d, want %v h for %d", c.minutes, s.Hours, s.FeeCents, c.hours, c.fee)
		}
		start += 120
	}
	// A fee typed for it is its whole fee, however long.
	if s := create(t, a, bookMinutes(jane, start, start+90)); s.FeeCents != 13500 {
		t.Errorf("before typing: %+v", s)
	} else if err := a.Must("sessions.update", map[string]any{"id": s.ID, "fee": map[string]any{"cents": 10000}}, &s); err != nil {
		t.Fatal(err)
	} else if s.FeeCents != 10000 || len(s.Credits) != 0 {
		t.Errorf("typed: %+v", s)
	}
}

func TestCreditsPayByTheHalfHour(t *testing.T) {
	a, jane, bob := setup(t)
	first := buyPackage(t, a, jane, 1)

	// Half of its hour pays for a half-hour session.
	s := create(t, a, bookMinutes(jane, 120, 150))
	if len(s.Credits) != 1 || s.Credits[0].Hours != 0.5 || s.Invoice != nil {
		t.Errorf("half hour: %+v", s)
	}
	// What the first package has left, then the next one's.
	second := buyPackage(t, a, jane, 2)
	s = create(t, a, bookMinutes(jane, 240, 330))
	want := []sessions.CreditView{{PackageID: first, Hours: 0.5}, {PackageID: second, Hours: 1}}
	if len(s.Credits) != 2 || s.Credits[0] != want[0] || s.Credits[1] != want[1] || s.Invoice != nil {
		t.Errorf("spilling over: %+v, want %+v", s.Credits, want)
	}
	// What credits leave is charged at the usual hourly fee.
	s = create(t, a, bookMinutes(jane, 360, 450))
	if len(s.Credits) != 1 || s.Credits[0].Hours != 1 || s.FeeCents != 4500 {
		t.Errorf("credits short: %+v", s)
	}
	// Shorter, the credits pay it all, and it comes off its invoice.
	var shorter sessions.View
	if err := a.Must("sessions.update", map[string]any{"id": s.ID, "time": map[string]any{"start": testapp.Epoch.Add(6 * time.Hour), "end": testapp.Epoch.Add(7 * time.Hour)}}, &shorter); err != nil {
		t.Fatal(err)
	}
	if shorter.Hours != 1 || shorter.Invoice != nil || shorter.FeeCents != 0 {
		t.Errorf("shorter: %+v", shorter)
	}
	var pkgs []struct {
		ID          string
		CreditsLeft float64
	}
	if err := a.Must("packages.list", map[string]any{"all": true}, &pkgs); err != nil {
		t.Fatal(err)
	}
	for _, p := range pkgs {
		if p.CreditsLeft != 0 {
			t.Errorf("package %s has %v h left, want none", p.ID, p.CreditsLeft)
		}
	}

	// Without a usual fee, what credits leave is refused: a package is
	// cheaper, so the user enters the fee.
	buyPackage(t, a, bob, 1)
	refusal(t, a, "sessions.create", bookMinutes(bob, 600, 690))
	if s := create(t, a, bookMinutes(bob, 600, 660)); len(s.Credits) != 1 {
		t.Errorf("an hour of Bob's: %+v", s)
	}
}

func TestAPaymentIsInFull(t *testing.T) {
	a, jane, _ := setup(t)
	s := create(t, a, book(jane, -3, -2, nil))
	pay := map[string]any{"items": []map[string]any{{"kind": "session", "id": s.ID}}, "payment": map[string]any{"method": "cash"}}
	if err := a.Must("payments.set", pay, nil); err != nil {
		t.Fatal(err)
	}
	var paid sessions.FullView
	if err := a.Must("sessions.get", map[string]any{"id": s.ID}, &paid); err != nil {
		t.Fatal(err)
	}
	if paid.Paid == nil || paid.Paid.AmountCents != 9000 || paid.OwedCents != 0 || paid.Can.Pay.OK {
		t.Errorf("paid: %+v", paid.View)
	}

	// A new fee would leave it paid the old one: refused, unless the
	// payment moves with it.
	if r := refusal(t, a, "sessions.update", map[string]any{"id": s.ID, "fee": map[string]any{"cents": 9500}}); r == nil || r.Action != "payments.set" {
		t.Errorf("remedy = %+v, want undoing the payment", r)
	}
	if err := a.Must("sessions.update", map[string]any{"id": s.ID, "fee": map[string]any{"cents": 9500}, "updatePayment": true}, &paid.View); err != nil {
		t.Fatal(err)
	}
	if paid.Paid.AmountCents != 9500 {
		t.Errorf("paid %d, want the new fee", paid.Paid.AmountCents)
	}

	// Deleting it would lose the record of the money.
	if r := refusal(t, a, "sessions.delete", map[string]any{"id": s.ID}); r == nil || r.Action != "payments.set" {
		t.Errorf("remedy = %+v, want undoing the payment", r)
	}
}

func TestAnIssuedInvoiceIsFinal(t *testing.T) {
	a, jane, _ := setup(t)
	s := create(t, a, book(jane, 2, 3, map[string]any{"tentative": true}))

	// Issued for confirmed sessions only.
	if r := refusal(t, a, "documents.issue", map[string]any{"id": s.Invoice.ID}); r == nil || r.Action != "sessions.update" {
		t.Errorf("remedy = %+v, want confirming the session", r)
	}
	if err := a.Must("sessions.update", map[string]any{"id": s.ID, "tentative": false}, nil); err != nil {
		t.Fatal(err)
	}
	var inv documents.View
	if err := a.Must("documents.issue", map[string]any{"id": s.Invoice.ID}, &inv); err != nil {
		t.Fatal(err)
	}
	if inv.Number != "INV260001" || inv.ShareToken == "" || len(inv.Revisions) != 1 {
		t.Errorf("issued: %+v", inv.Summary)
	}

	// Its fee is final; moving the session is a correction, drafted on top.
	if r := refusal(t, a, "sessions.update", map[string]any{"id": s.ID, "fee": map[string]any{"cents": 5000}}); r == nil || r.Action != "documents.cancel" {
		t.Errorf("remedy = %+v, want cancelling the invoice", r)
	}
	if err := a.Must("sessions.update", map[string]any{"id": s.ID, "time": map[string]any{"start": at(26), "end": at(27)}}, nil); err != nil {
		t.Fatal(err)
	}
	if err := a.Must("documents.get", map[string]any{"id": inv.ID}, &inv); err != nil {
		t.Fatal(err)
	}
	if !inv.Revising || inv.Draft.Lines[0].Date != "2026-10-14" || inv.Content.Lines[0].Date != "2026-10-13" {
		t.Errorf("after moving: revising %v, %+v", inv.Revising, inv.Draft)
	}

	// Cancelling it puts its lines back on a draft, where the fee can
	// change.
	if err := a.Must("documents.cancel", map[string]any{"id": inv.ID, "reason": "Wrong fee"}, nil); err != nil {
		t.Fatal(err)
	}
	var after sessions.View
	if err := a.Must("sessions.update", map[string]any{"id": s.ID, "fee": map[string]any{"cents": 5000}}, &after); err != nil {
		t.Fatal(err)
	}
	if after.FeeCents != 5000 || after.Invoice.ID == inv.ID || after.Invoice.Number != "" {
		t.Errorf("after cancelling: %+v", after)
	}
}

func TestAClientWithSessionsIsKept(t *testing.T) {
	a, jane, _ := setup(t)
	create(t, a, book(jane, 2, 3, nil))
	refusal(t, a, "clients.delete", map[string]any{"id": jane})
}

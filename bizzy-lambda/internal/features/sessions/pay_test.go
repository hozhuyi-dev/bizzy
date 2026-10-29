package sessions_test

import (
	"testing"

	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/testutil/testapp"
)

func full(t *testing.T, a *testapp.App, id string) sessions.FullView {
	t.Helper()
	var v sessions.FullView
	if err := a.Must("sessions.get", map[string]any{"id": id}, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func update(t *testing.T, a *testapp.App, in map[string]any) sessions.View {
	t.Helper()
	var v sessions.View
	if err := a.Must("sessions.update", in, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func pay(by sessions.PayBy, packageID string) map[string]any {
	return map[string]any{"by": by, "packageId": packageID}
}

// A session paid by its fee before a package was bought is moved onto it
// when the user says, from the session or from the package; back again
// to its fee; and a package bought later pays only once chosen.
func TestASessionSwitchesBetweenPackageAndFee(t *testing.T) {
	a, jane, _ := setup(t)
	before := create(t, a, book(jane, -48, -47, nil))
	if before.Pay.By != sessions.PayByFee || before.FeeCents != 9000 {
		t.Fatalf("with no package: %+v, want paid by its usual fee", before.Pay)
	}
	// Bought at Epoch, after that session.
	pkg := buyPackage(t, a, jane, 10)
	if after := create(t, a, book(jane, 2, 3, nil)); after.Pay.By != sessions.PayByPackage || len(after.Credits) != 1 || after.Invoice != nil {
		t.Errorf("after the package: %+v, credits %+v, want paid by it", after.Pay, after.Credits)
	}
	// Another session from before the package, entered now: its fee pays,
	// unless the user chooses the package.
	late := create(t, a, book(jane, -30, -29, nil))
	if late.Pay.By != sessions.PayByFee {
		t.Errorf("one from before the package: %+v, want paid by its fee", late.Pay)
	}

	// The package is offered, saying it was bought later.
	options := full(t, a, before.ID).PayOptions
	if len(options) != 1 || options[0].PackageID != pkg || !options[0].After || options[0].HoursLeft != 9 {
		t.Fatalf("options = %+v", options)
	}
	// Oldest first takes only packages bought by then: still charged.
	if v := update(t, a, map[string]any{"id": before.ID, "pay": pay(sessions.PayByPackage, "")}); len(v.Credits) != 0 || v.FeeCents != 9000 {
		t.Errorf("oldest first: credits %+v, fee %d", v.Credits, v.FeeCents)
	}
	// Chosen, it pays, whenever it was bought, and the fee goes.
	moved := update(t, a, map[string]any{"id": before.ID, "pay": pay(sessions.PayByPackage, pkg)})
	if len(moved.Credits) != 1 || moved.Credits[0].PackageID != pkg || moved.Invoice != nil || moved.FeeCents != 0 {
		t.Errorf("chosen: %+v", moved)
	}
	// Moved again, its choice stays.
	if v := update(t, a, map[string]any{"id": before.ID, "time": map[string]any{"start": at(-50), "end": at(-49)}}); len(v.Credits) != 1 {
		t.Errorf("rescheduled: credits %+v, want the package still", v.Credits)
	}

	// From the package's side: the sessions its clients' fee pays.
	var movable []sessions.View
	if err := a.Must("sessions.movable", map[string]any{"packageId": pkg}, &movable); err != nil {
		t.Fatal(err)
	}
	if len(movable) != 1 || movable[0].ID != late.ID || !movable[0].Can.ChangePay.OK {
		t.Fatalf("movable = %+v", movable)
	}
	if err := a.Must("sessions.moveToPackage", map[string]any{"packageId": pkg, "sessionIds": []string{late.ID}}, nil); err != nil {
		t.Fatal(err)
	}
	if v := full(t, a, late.ID); len(v.Credits) != 1 || v.Invoice != nil {
		t.Errorf("moved to the package: %+v", v.View)
	}

	// Back to its fee: the usual one, the credits free again.
	if v := update(t, a, map[string]any{"id": late.ID, "pay": pay(sessions.PayByFee, "")}); len(v.Credits) != 0 || v.FeeCents != 9000 || v.Pay.PackageID != "" {
		t.Errorf("back to its fee: %+v", v)
	}
	if left := full(t, a, late.ID).PayOptions[0].HoursLeft; left != 8 {
		t.Errorf("hours left = %v, want 8 (two sessions on it)", left)
	}

	// A fee typed is paid by it; cleared, it is paid as a new one would
	// be (the calendar's title losing its amount).
	if v := update(t, a, map[string]any{"id": late.ID, "fee": fee(9500)["fee"]}); v.Pay.By != sessions.PayByFee || v.FeeCents != 9500 {
		t.Errorf("typed: %+v", v)
	}
	if _, refused, _ := a.Call("sessions.update", map[string]any{"id": late.ID, "fee": fee(9500)["fee"], "pay": pay(sessions.PayByPackage, "")}); refused == nil || refused.Code != apperr.CodeInvalid {
		t.Errorf("a fee typed while paying by package: %+v, want it invalid", refused)
	}
}

// A session paid stays paid as it was, and one an issued invoice charges
// stays charged: each refusal says what to undo first.
func TestHowAPaidSessionIsPaidStays(t *testing.T) {
	a, jane, _ := setup(t)
	pkg := buyPackage(t, a, jane, 10)
	paid := create(t, a, book(jane, -5, -4, map[string]any{"pay": pay(sessions.PayByFee, "")}))
	if paid.Pay.By != sessions.PayByFee || len(paid.Credits) != 0 {
		t.Fatalf("chosen when booked: %+v", paid)
	}
	in := map[string]any{"items": []map[string]any{{"kind": "session", "id": paid.ID}}, "payment": map[string]any{"method": "cash"}}
	if err := a.Must("payments.set", in, nil); err != nil {
		t.Fatal(err)
	}
	v := full(t, a, paid.ID)
	if v.Can.ChangePay.OK || v.Locked["pay"].Why == "" {
		t.Errorf("paid: can %+v, locked %+v", v.Can.ChangePay, v.Locked)
	}
	if r := refusal(t, a, "sessions.update", map[string]any{"id": paid.ID, "pay": pay(sessions.PayByPackage, pkg)}); r == nil || r.Action != "payments.set" {
		t.Errorf("remedy = %+v, want undoing the payment", r)
	}
	if r := refusal(t, a, "sessions.moveToPackage", map[string]any{"packageId": pkg, "sessionIds": []string{paid.ID}}); r == nil || r.Action != "payments.set" {
		t.Errorf("remedy = %+v, want undoing the payment", r)
	}

	invoiced := create(t, a, book(jane, -3, -2, map[string]any{"pay": pay(sessions.PayByFee, "")}))
	if err := a.Must("documents.issue", map[string]any{"id": invoiced.Invoice.ID}, nil); err != nil {
		t.Fatal(err)
	}
	if r := refusal(t, a, "sessions.update", map[string]any{"id": invoiced.ID, "pay": pay(sessions.PayByPackage, "")}); r == nil || r.Action != "documents.cancel" {
		t.Errorf("remedy = %+v, want cancelling the invoice", r)
	}
}

package sessions

import (
	"slices"
	"testing"
	"time"

	"bizzy-lambda/internal/features/docref"
	"bizzy-lambda/internal/features/money"
)

var now = time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC)

func fee(v int64) *int64 { return &v }

// happened is a priced session that ended an hour ago.
func happened() Session {
	return Session{
		EventID: "e", Start: now.Add(-2 * time.Hour), End: now.Add(-time.Hour),
		Status: StatusPriced, ClientID: "jane", FeeCents: fee(9500),
	}
}

func TestTodo(t *testing.T) {
	removed := happened()
	removed.RemovedAt = &now
	removed.Record = &Record{Summary: "x"}

	recorded := happened()
	recorded.Record = &Record{Summary: "Knee mobilisation"}

	paid := happened()
	paid.Payment = &money.Payment{Status: money.Paid, Method: money.MethodCash, AmountCents: 9500}

	done := recorded
	done.Payment = &money.Payment{Status: money.Waived}

	covered := happened()
	covered.Status, covered.FeeCents = StatusPackage, nil
	covered.Record = &Record{Summary: "x"}

	booked := happened()
	booked.Start, booked.End = now.Add(time.Hour), now.Add(2*time.Hour)

	tentative := booked
	tentative.Status = StatusTentative

	unmatched := happened()
	unmatched.Status, unmatched.ClientID = StatusUnmatched, ""

	// Paid for the session, but the package it bought is still due.
	packageDue := paid
	packageDue.Record = &Record{Summary: "x"}
	packageDue.BoughtCents = 85000

	packagePaid := packageDue
	packagePaid.BoughtSettled = true

	tests := []struct {
		name string
		s    Session
		want []Reason
	}{
		{"deleted with her data", removed, []Reason{ReasonDeleted}},
		{"happened", happened(), []Reason{ReasonRecord, ReasonCollect}},
		{"recorded, unpaid", recorded, []Reason{ReasonCollect}},
		{"paid before notes", paid, []Reason{ReasonRecord}},
		{"recorded and waived", done, nil},
		{"package credit costs nothing more", covered, nil},
		{"booked ahead", booked, nil},
		{"tentative", tentative, []Reason{ReasonConfirm}},
		{"unmatched", unmatched, []Reason{ReasonFix}},
		{"package bought, unpaid", packageDue, []Reason{ReasonCollect}},
		{"package bought, paid", packagePaid, nil},
	}
	for _, tt := range tests {
		if got := tt.s.Todo(now); !slices.Equal(got, tt.want) {
			t.Errorf("%s: Todo = %v, want %v", tt.name, got, tt.want)
		}
		// Anything with something to do now must be in the open index.
		if len(tt.want) > 0 && !tt.s.Open() {
			t.Errorf("%s: not in the open index", tt.name)
		}
	}

	// A booking stays in the index (read only a few days ahead) until
	// recorded and paid.
	if !booked.Open() || done.Open() || packagePaid.Open() {
		t.Errorf("open: booked %v, done %v, package paid %v", booked.Open(), done.Open(), packagePaid.Open())
	}
}

func TestTheFeeAndThePackageAreDueSeparately(t *testing.T) {
	s := happened()
	s.BoughtCents = 85000
	if s.DueCents() != 9500 || !s.BoughtDue() || s.Paid() {
		t.Errorf("due %d, package due %v, paid %v: want the fee, and the package on its own", s.DueCents(), s.BoughtDue(), s.Paid())
	}
	s.Payment = &money.Payment{Status: money.Paid, Method: money.MethodCash, AmountCents: 9500}
	if !s.FeeSettled() || s.Paid() {
		t.Error("paying the fee leaves the package due")
	}
	s.BoughtSettled = true
	if !s.Paid() {
		t.Error("both paid")
	}

	// The package bought, its first credit used: only the package is due.
	s = happened()
	s.Status, s.FeeCents, s.BoughtCents = StatusPackage, nil, 85000
	if s.DueCents() != 0 || !s.FeeSettled() || !s.BoughtDue() {
		t.Errorf("due %d, package due %v", s.DueCents(), s.BoughtDue())
	}
}

func TestDocumentsNeedTheirStage(t *testing.T) {
	s := happened()
	if !s.CanInvoice() || s.CanReceipt() {
		t.Errorf("unpaid: invoice %v receipt %v, want invoice only", s.CanInvoice(), s.CanReceipt())
	}
	s.Payment = &money.Payment{Status: money.Paid, Method: money.MethodTNG, AmountCents: 9500}
	if !s.CanReceipt() {
		t.Error("a paid session can get a receipt")
	}
	s.Invoice = &docref.Ref{DocumentID: "d"}
	if s.CanInvoice() {
		t.Error("one invoice per session")
	}
	s.Payment = &money.Payment{Status: money.Waived}
	if s.CanReceipt() {
		t.Error("a waived session has nothing to receipt")
	}
}

func TestKeysFollowTheIndexes(t *testing.T) {
	s := happened()
	rec := toRecord(s)
	if rec.PK != "SESSION" || rec.SK != "e" || rec.LSI2SK != "jane#"+rec.LSI1SK || rec.LSI3SK == "" || rec.LSI4SK != "priced#"+rec.LSI1SK {
		t.Errorf("keys = %+v", rec.Keys)
	}
	s.Record = &Record{Summary: "x"}
	s.Payment = &money.Payment{Status: money.Paid}
	if toRecord(s).LSI3SK != "" {
		t.Error("a settled session must leave the to-do index")
	}
}

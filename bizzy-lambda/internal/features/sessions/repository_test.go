package sessions

import (
	"slices"
	"testing"
	"time"

	"bizzy-lambda/internal/features/docref"
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
	paid.Payment = &Payment{Status: PaymentPaid, Method: MethodCash, AmountCents: 9500}

	done := recorded
	done.Payment = &Payment{Status: PaymentWaived}

	covered := happened()
	covered.Status, covered.FeeCents = StatusPackage, nil
	covered.Record = &Record{Summary: "x"}

	booked := happened()
	booked.Start, booked.End = now.Add(time.Hour), now.Add(2*time.Hour)

	tentative := booked
	tentative.Status = StatusTentative

	unmatched := happened()
	unmatched.Status, unmatched.ClientID = StatusUnmatched, ""

	untracked := happened()
	untracked.Untracked = true

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
		{"history before tracking", untracked, nil},
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
	if !booked.Open() || done.Open() || untracked.Open() {
		t.Errorf("open: booked %v, done %v, untracked %v", booked.Open(), done.Open(), untracked.Open())
	}
}

func TestDueCents(t *testing.T) {
	s := happened()
	s.BoughtCents = 85000
	if got := s.DueCents(); got != 94500 {
		t.Errorf("fee and package bought = %d, want 94500", got)
	}
	s.Status, s.FeeCents = StatusPackage, nil
	if got := s.DueCents(); got != 85000 {
		t.Errorf("package bought, first credit used = %d, want 85000", got)
	}
}

func TestDocumentsNeedTheirStage(t *testing.T) {
	s := happened()
	if !s.CanInvoice() || s.CanReceipt() {
		t.Errorf("unpaid: invoice %v receipt %v, want invoice only", s.CanInvoice(), s.CanReceipt())
	}
	s.Payment = &Payment{Status: PaymentPaid, Method: MethodTNG, AmountCents: 9500}
	if !s.CanReceipt() {
		t.Error("a paid session can get a receipt")
	}
	s.Invoice = &docref.Ref{DocumentID: "d"}
	if s.CanInvoice() {
		t.Error("one invoice per session")
	}
	s.Payment = &Payment{Status: PaymentWaived}
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
	s.Payment = &Payment{Status: PaymentPaid}
	if toRecord(s).LSI3SK != "" {
		t.Error("a settled session must leave the to-do index")
	}
}

package payments

import (
	"context"
	"errors"
	"testing"
	"time"

	"bizzy-lambda/internal/features/billing"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/shared/docref"
	"bizzy-lambda/internal/shared/money"
	"bizzy-lambda/internal/testutil/memory"
)

var (
	kl  = time.FixedZone("MYT", 8*60*60)
	now = time.Date(2026, 10, 20, 2, 0, 0, 0, time.UTC)
)

// setup syncs Jane's session that bought a package: RM95 for the session,
// RM850 for ten more.
func setup(t *testing.T) (*memory.Store, handler) {
	t.Helper()
	m := memory.New()
	fee := int64(9000)
	m.ClientMap["jane"] = clients.Client{ID: "jane", Name: "Jane Smith", Aliases: []string{"jane smith"}, DefaultFeeCents: &fee}

	r := &billing.Reconciler{
		Clients: m.Clients(), Sessions: m.Sessions(), Packages: m.Packages(), Settings: m.Settings(),
		Location: kl, Now: func() time.Time { return now },
	}
	start := time.Date(2026, 10, 1, 2, 0, 0, 0, time.UTC)
	event := calendar.Event{ID: "e1", Title: "Jane Smith 95 10x85", Start: start, End: start.Add(time.Hour)}
	if _, err := r.Reconcile(context.Background(), billing.Scope{Changes: []billing.Change{{EventID: "e1", Event: &event}}}); err != nil {
		t.Fatal(err)
	}

	h := handler{
		store: m.Payments(),
		afterChange: func(ctx context.Context, ids ...string) error {
			_, err := r.Reconcile(ctx, billing.Scope{ClientIDs: ids})
			return err
		},
		now: func() time.Time { return now },
		loc: kl,
	}
	return m, h
}

var cash = &money.Input{Status: money.Paid, Method: money.MethodCash}

func TestPayBothAtOnce(t *testing.T) {
	m, h := setup(t)
	if s := m.SessionMap["e1"]; s.Paid() || s.DueCents() != 9500 || !s.BoughtDue() {
		t.Fatalf("before = paid %v due %d package due %v", s.Paid(), s.DueCents(), s.BoughtDue())
	}

	_, err := h.set(context.Background(), setInput{
		Items:   []Item{{Kind: KindSession, ID: "e1"}, {Kind: KindPackage, ID: "e1"}},
		Payment: cash,
	})
	if err != nil {
		t.Fatal(err)
	}

	s, p := m.SessionMap["e1"], m.PackageMap["e1"]
	if s.Payment.AmountCents != 9500 || p.Payment.AmountCents != 85000 || p.Payment.PaidOn != "2026-10-20" {
		t.Errorf("payments = session %+v package %+v, want each at its own price, today", s.Payment, p.Payment)
	}
	// The reconcile ran: the session mirrors its package, and the money is
	// October's income.
	if !s.Paid() || !s.BoughtSettled {
		t.Errorf("session paid %v bought settled %v", s.Paid(), s.BoughtSettled)
	}
	if got := m.ClientMap["jane"].Activity["2026-10"].ReceivedCents; got != 94500 {
		t.Errorf("received = %d, want both", got)
	}
}

func TestPayTheSessionOnlyThenUndo(t *testing.T) {
	m, h := setup(t)
	ctx := context.Background()

	if _, err := h.set(ctx, setInput{Items: []Item{{Kind: KindSession, ID: "e1", AmountCents: 9000}}, Payment: cash}); err != nil {
		t.Fatal(err)
	}
	s := m.SessionMap["e1"]
	if s.Payment.AmountCents != 9000 || m.PackageMap["e1"].Payment != nil || !s.BoughtDue() {
		t.Errorf("session paid %+v, package %+v: want the package still due", s.Payment, m.PackageMap["e1"].Payment)
	}

	if _, err := h.set(ctx, setInput{Items: []Item{{Kind: KindSession, ID: "e1"}}}); err != nil {
		t.Fatal(err)
	}
	if m.SessionMap["e1"].Payment != nil {
		t.Error("undo clears the payment")
	}
}

func TestReceiptLocksThePayment(t *testing.T) {
	m, h := setup(t)
	p := m.PackageMap["e1"]
	p.Receipt = &docref.Ref{DocumentID: "d"}
	m.PackageMap["e1"] = p

	_, err := h.set(context.Background(), setInput{
		Items:   []Item{{Kind: KindSession, ID: "e1"}, {Kind: KindPackage, ID: "e1"}},
		Payment: cash,
	})
	var appErr *apperr.Error
	if !errors.As(err, &appErr) || appErr.Code != apperr.CodeConflict {
		t.Fatalf("err = %v, want conflict", err)
	}
	if m.SessionMap["e1"].Payment != nil {
		t.Error("all or none: the session must not be paid either")
	}
}

func TestRetriesAfterAConcurrentWrite(t *testing.T) {
	m, h := setup(t)
	store := &bumpOnce{PaymentRepo: m.Payments(), m: m}
	h.store = store

	if _, err := h.set(context.Background(), setInput{Items: []Item{{Kind: KindSession, ID: "e1"}}, Payment: cash}); err != nil {
		t.Fatal(err)
	}
	if !store.bumped || m.SessionMap["e1"].Payment == nil {
		t.Error("a conflict is retried against the fresh session")
	}
}

// bumpOnce writes the session (as a sync would) between the first read and
// commit.
type bumpOnce struct {
	*memory.PaymentRepo
	m      *memory.Store
	bumped bool
}

func (b *bumpOnce) Commit(ctx context.Context, ss []sessions.Session, ps []packages.Package) error {
	if !b.bumped {
		b.bumped = true
		s := b.m.SessionMap["e1"]
		s.Version++
		b.m.SessionMap["e1"] = s
	}
	return b.PaymentRepo.Commit(ctx, ss, ps)
}

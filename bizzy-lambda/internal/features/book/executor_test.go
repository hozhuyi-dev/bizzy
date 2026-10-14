package book_test

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"bizzy-lambda/internal/features/book"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/shared/money"
	"bizzy-lambda/internal/testutil/memory"
)

var (
	kl   = time.FixedZone("MYT", 8*60*60)
	now  = time.Date(2026, 10, 13, 2, 0, 0, 0, time.UTC)
	jane = clients.Client{ID: "jane", Name: "Jane Smith", Aliases: []string{"jane smith"}, FeeRates: []clients.FeeRate{{Cents: 9000}}}
	bob  = clients.Client{ID: "bob", Name: "Bob Lee", Aliases: []string{"bob lee"}}
)

type fixture struct {
	t     *testing.T
	store *memory.Store
	x     book.Executor
	ids   int
}

func newFixture(t *testing.T) *fixture {
	f := &fixture{t: t, store: memory.New()}
	f.store.SettingsVal = settings.Settings{BusinessName: "Physio Co", ServiceName: "Physiotherapy"}
	f.store.ClientMap["jane"], f.store.ClientMap["bob"] = jane, bob
	f.x = book.Executor{
		Store: f.store.Book(), Location: kl, Now: func() time.Time { return now },
		NewID: func() string { f.ids++; return fmt.Sprintf("id%02d", f.ids) },
	}
	return f
}

func (f *fixture) do(cmd book.Command) *book.Book {
	f.t.Helper()
	b, err := f.x.Do(context.Background(), cmd)
	if err != nil {
		f.t.Fatalf("%s: %v", cmd.Action(), err)
	}
	return b
}

// refused runs a command that must be refused by guard, and returns the
// refusal.
func (f *fixture) refused(cmd book.Command, guard string) *apperr.Error {
	f.t.Helper()
	before := f.store.Writes
	_, err := f.x.Do(context.Background(), cmd)
	var appErr *apperr.Error
	if !errors.As(err, &appErr) || appErr.Guard != guard {
		f.t.Fatalf("%s: got %v, want refused by %s", cmd.Action(), err, guard)
	}
	if f.store.Writes != before {
		f.t.Fatalf("%s was refused but wrote", cmd.Action())
	}
	return appErr
}

func (f *fixture) book(clientID string) *book.Book {
	f.t.Helper()
	b, err := f.x.Load(context.Background(), book.Scope{Clients: []string{clientID}})
	if err != nil {
		f.t.Fatal(err)
	}
	if broken := b.Check(); len(broken) > 0 {
		f.t.Fatalf("stored book breaks %v", broken)
	}
	return b
}

var sessionsRecord = sessions.Record{Summary: "Knee mobilisation"}

func at(hours int) time.Time { return now.Add(time.Duration(hours) * time.Hour) }

func booking(clientID string, start time.Time) book.Booking {
	return book.Booking{ClientID: clientID, Start: start, End: start.Add(time.Hour), Location: sessions.LocationOwn}
}

func cents(v int64) *int64 { return &v }

func (f *fixture) book1(id string, bk book.Booking) {
	f.t.Helper()
	f.do(book.CreateSession{ID: id, Booking: bk})
}

// A session is booked with its fee on a draft invoice; the fee is the line.
func TestBookingDraftsTheInvoice(t *testing.T) {
	f := newFixture(t)
	f.book1("s1", booking("jane", at(-24)))
	b := f.book("jane")
	s := b.Sessions["s1"]
	if s.FeeCents != 9000 || s.Invoice == nil || s.Invoice.Issued() || s.FeeTyped {
		t.Fatalf("session = %+v, want the usual fee on a draft invoice", s)
	}
	d := b.Docs[s.Invoice.DocumentID]
	if d.Status != documents.StatusDraft || len(d.Draft.Lines) != 1 || d.Draft.Lines[0].AmountCents != 9000 {
		t.Fatalf("draft = %+v", d)
	}
	if !s.Event.Pending {
		t.Error("its event is still to be written")
	}

	// Bob has no usual fee: refused, with what would settle it.
	refusal := f.refused(book.CreateSession{ID: "s2", Booking: booking("bob", at(-24))}, "fee-known")
	if refusal.Remedies[0].Action != "clients.save" || refusal.Remedies[0].Target != "bob" {
		t.Errorf("remedies = %+v", refusal.Remedies)
	}
}

// Principle 2: what was received is the receipt, and an issued document
// never changes.
func TestIssuedDocumentsNeverChange(t *testing.T) {
	f := newFixture(t)
	f.book1("s1", booking("jane", at(-24)))
	f.do(book.SetPayment{Items: []book.Item{{Kind: book.ItemSession, ID: "s1"}}, Payment: &money.Input{Method: money.MethodCash}})
	s := f.book("jane").Sessions["s1"]
	if s.Paid == nil || s.Paid.AmountCents != 9000 || s.Receipt == nil {
		t.Fatalf("session = %+v, want paid on a draft receipt", s)
	}

	// The fee can't move away from what was received...
	up := book.UpdateSession{ID: "s1", Booking: booking("jane", at(-24))}
	up.FeeCents = cents(12000)
	f.refused(up, "paid-in-full")
	// ...unless the payment moves with it, while its receipt is a draft.
	up.UpdatePayment = true
	f.do(up)
	if s := f.book("jane").Sessions["s1"]; s.FeeCents != 12000 || s.Paid.AmountCents != 12000 || !s.FeeTyped {
		t.Fatalf("session = %+v", s)
	}

	// Once the invoice is issued, its fee is final.
	inv := f.book("jane").Sessions["s1"].Invoice.DocumentID
	f.do(book.Issue{ID: inv})
	up.FeeCents = cents(15000)
	refusal := f.refused(up, "issued-documents-never-change")
	if refusal.Remedies[0].Action != "documents.cancel" || refusal.Remedies[0].Target != inv {
		t.Errorf("remedies = %+v", refusal.Remedies)
	}
	// Cancelling it puts its line back on a draft, and the fee can change.
	f.do(book.Cancel{ID: inv, Reason: "Wrong fee"})
	f.do(up)
	b := f.book("jane")
	if s := b.Sessions["s1"]; s.FeeCents != 15000 || s.Invoice.Issued() {
		t.Fatalf("session = %+v", s)
	}
	if b.Docs[inv].Status != documents.StatusCancelled {
		t.Error("the cancelled invoice stays, cancelled")
	}

	// A revision may correct the name, never what it charges.
	inv = b.Sessions["s1"].Invoice.DocumentID
	f.do(book.Issue{ID: inv})
	d := f.book("jane").Docs[inv]
	f.do(book.Revise{ID: inv, Version: d.Version})
	d = f.book("jane").Docs[inv]
	draft := *d.Draft
	draft.Recipient.Name = "Jane Smyth-Smith"
	f.do(book.SaveDraft{ID: inv, Version: d.Version, Content: draft})
	d = f.book("jane").Docs[inv]
	draft = *d.Draft
	draft.Lines = slices.Clone(draft.Lines)
	draft.Lines[0].AmountCents = 1
	f.refused(book.SaveDraft{ID: inv, Version: d.Version, Content: draft}, "revision-only-corrects")
}

// Rescheduling a session on an issued invoice is allowed: the date is a
// correction, drafted as the invoice's next revision.
func TestRescheduleDraftsARevision(t *testing.T) {
	f := newFixture(t)
	f.book1("s1", booking("jane", at(24)))
	inv := f.book("jane").Sessions["s1"].Invoice.DocumentID
	f.do(book.Issue{ID: inv})
	f.do(book.UpdateSession{ID: "s1", Booking: booking("jane", at(72))})
	d := f.book("jane").Docs[inv]
	if d.Draft == nil || d.Draft.Lines[0].Date == d.Content.Lines[0].Date {
		t.Fatalf("invoice = %+v, want a revision drafted with the new date", d)
	}
	f.do(book.Issue{ID: inv, Version: d.Version})
	if d := f.book("jane").Docs[inv]; *d.Revision != 1 {
		t.Errorf("revision = %d", *d.Revision)
	}
}

// A package bought in a session uses its first credit; its credits stay
// where they were given.
func TestPackageCredits(t *testing.T) {
	f := newFixture(t)
	bk := booking("jane", at(-48))
	bk.Package = &book.PackageSpec{Sessions: 2, PriceCents: 17000}
	f.book1("s1", bk)
	b := f.book("jane")
	s := b.Sessions["s1"]
	p := b.Packages[s.BoughtPackageID]
	if s.PackageID != p.ID || p.CreditsUsed != 1 || p.PriceCents != 17000 || s.BoughtOwedCents != 17000 {
		t.Fatalf("session %+v, package %+v", s, p)
	}
	f.book1("s2", booking("jane", at(-24)))
	f.book1("s3", booking("jane", at(-1)))
	b = f.book("jane")
	if b.Sessions["s2"].PackageID != p.ID || b.Sessions["s3"].OnCredit() || b.Sessions["s3"].FeeCents != 9000 {
		t.Fatalf("s2 %+v s3 %+v: the second credit, then the usual fee", b.Sessions["s2"], b.Sessions["s3"])
	}

	// Dropping the package from s1's title: s2 still uses it.
	drop := book.UpdateSession{ID: "s1", Booking: booking("jane", at(-48))}
	refusal := f.refused(drop, "credits-in-hand")
	if refusal.Remedies[0].Action != "packages.makeStandalone" {
		t.Errorf("remedies = %+v", refusal.Remedies)
	}
	// Kept on its own, the title buys nothing and the package stays.
	f.do(book.MakeStandalone{ID: p.ID})
	if b := f.book("jane"); b.Sessions["s1"].BoughtPackageID != "" || b.Packages[p.ID].BoughtIn != "" {
		t.Fatal("made standalone")
	}
}

// What was received is never deleted with what it paid for; a calendar
// delete never takes her notes.
func TestDeletesKeepMoneyAndNotes(t *testing.T) {
	f := newFixture(t)
	f.book1("s1", booking("jane", at(-24)))
	f.do(book.SetPayment{Items: []book.Item{{Kind: book.ItemSession, ID: "s1"}}, Payment: &money.Input{Method: money.MethodCash}})
	f.refused(book.DeleteSession{ID: "s1"}, "delete-keeps-money")
	f.do(book.SetPayment{Items: []book.Item{{Kind: book.ItemSession, ID: "s1"}}})
	f.do(book.DeleteSession{ID: "s1"})
	if _, ok := f.store.SessionMap["s1"]; ok || len(f.store.Docs) != 0 {
		t.Fatalf("the session and its drafts go: %+v", f.store.Docs)
	}

	f.book1("s2", booking("jane", at(-24)))
	s := f.store.SessionMap["s2"]
	s.Record = &sessionsRecord
	s.Event = calendar.Link{EventID: "e2", Seen: &calendar.Snapshot{Title: "Jane Smith"}}
	f.store.SessionMap["s2"] = s
	f.refused(book.DeleteSession{ID: "s2", FromCalendar: true}, "calendar-delete-keeps-the-record")
}

// A draft invoice holds what it charges: it goes with them, or its lines
// move to another draft.
func TestDraftsMergeAndStay(t *testing.T) {
	f := newFixture(t)
	f.book1("s1", booking("jane", at(-48)))
	f.book1("s2", booking("jane", at(-24)))
	b := f.book("jane")
	d1, d2 := b.Sessions["s1"].Invoice.DocumentID, b.Sessions["s2"].Invoice.DocumentID
	f.refused(book.DiscardDraft{ID: d1}, "fees-stay-invoiced")
	f.do(book.MoveLines{From: d2, To: d1, LineIDs: []string{b.Docs[d2].Draft.Lines[0].ID}})
	b = f.book("jane")
	if _, ok := b.Docs[d2]; ok || b.Sessions["s2"].Invoice.DocumentID != d1 || b.Docs[d1].TotalCents != 18000 {
		t.Fatalf("merged: %+v", b.Docs[d1])
	}
}

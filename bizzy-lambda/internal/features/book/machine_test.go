package book_test

import (
	"flag"
	"fmt"
	"maps"
	"slices"
	"testing"
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/features/book"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/command"
	"bizzy-lambda/internal/shared/money"
)

// The guard table as a pure machine (command.Machine): random sequences
// of every book command, decided on an in-memory book, with no store or
// calendar in the way. TestGuardTableHolds checks that nothing the guards
// let through breaks what they keep; -guards.necessity checks that each
// guard is needed for that, by turning it off and finding a run that then
// breaks something.

var necessity = flag.Bool("guards.necessity", false, "check every guard of the book is needed (slow)")

// machine is the book's: three clients (one whose name ends like an amount,
// so a title can't say it), and every command drawn from what the book has.
var machine = command.Machine[*book.Book]{
	Start: func() *book.Book {
		ids := 0
		return book.New(book.Loaded{
			Settings: settings.Settings{BusinessName: "Physio Co", ServiceName: "Physiotherapy"},
			Clients: []clients.Client{
				{ID: "jane", Name: "Jane Smith", Aliases: []string{"jane smith"}, FeeRates: []clients.FeeRate{{Cents: 9000}}},
				{ID: "bob", Name: "Bob Lee", Aliases: []string{"bob lee"}, HomeVisits: true},
				{ID: "kid", Name: "Kid 2", Aliases: []string{"kid 2"}, FeeRates: []clients.FeeRate{{Cents: 5000}}},
			},
			ClientIDs: []string{"jane", "bob", "kid"},
		}, now, kl, func() string { ids++; return fmt.Sprintf("m%03d", ids) })
	},
	Draw: func(t *rapid.T, b *book.Book) command.Command {
		kinds := slices.Sorted(maps.Keys(draws))
		return draws[rapid.SampledFrom(kinds).Draw(t, "command")](t, b)
	},
	Decide: func(b *book.Book, cmd command.Command, off string) (*book.Book, []command.Violation, error) {
		return book.DecideWith(b, cmd.(book.Command), off)
	},
	Broken: func(before, after *book.Book, cmd command.Command) []string {
		return book.Broken(before, after, cmd.(book.Command))
	},
	Offers: func() map[string][]string {
		out := map[string][]string{}
		for _, g := range book.Guards {
			out[g.ID] = g.Remedies
		}
		return out
	}(),
	Steps: 60,
}

func TestGuardTableHolds(t *testing.T) {
	rapid.Check(t, machine.Check)
}

func TestEveryGuardIsNeeded(t *testing.T) {
	if !*necessity {
		t.Skip("run with -guards.necessity")
	}
	var ids []string
	for _, g := range book.Guards {
		ids = append(ids, g.ID)
	}
	// Guards another one shadows, kept for what they say.
	shadowed := map[string]string{
		// Paying for something that costs nothing is a payment on something
		// free, which undo-before-free refuses too, telling her to undo a
		// payment: this says plainly that nothing is owed.
		"pay-what-is-owed": "its message",
	}
	for _, id := range machine.Unneeded(ids, 300) {
		if _, ok := shadowed[id]; !ok {
			t.Errorf("no run needs %s: with it off, nothing breaks", id)
		}
	}
	// The control: with every guard on, no run breaks anything, so each
	// break above is the missing guard's.
	if got := machine.Unneeded([]string{"no-such-guard"}, 300); len(got) != 1 {
		t.Error("a run broke something with every guard on")
	}
}

// draws draw each kind of command, from what the book has; nil when
// there is nothing for it.
var draws = map[string]func(t *rapid.T, b *book.Book) command.Command{
	"sessions.create": func(t *rapid.T, b *book.Book) command.Command {
		return book.CreateSession{ID: b.NewID(), Booking: mBooking(t, b, "")}
	},
	"sessions.create from the calendar": func(t *rapid.T, b *book.Book) command.Command {
		e := calendar.Event{ID: b.NewID(), Title: "?", Start: mStart(t), ETag: "1"}
		e.End = e.Start.Add(time.Hour)
		cmd := book.CreateSession{ID: b.NewID(), Event: &e, Booking: mBooking(t, b, "")}
		if kind := rapid.SampledFrom([]book.ProblemKind{"", book.Unreadable, book.Unmatched}).Draw(t, "problem"); kind != "" {
			cmd.Problem = &book.Problem{Kind: kind, Text: "can't say", Name: "Zed", EventID: e.ID}
		}
		return cmd
	},
	"sessions.update": func(t *rapid.T, b *book.Book) command.Command {
		s := mPick(t, b.Sessions)
		if s == nil {
			return nil
		}
		cmd := book.UpdateSession{ID: s.ID, Booking: mBooking(t, b, s.ClientID), UpdatePayment: rapid.Bool().Draw(t, "update payment")}
		if rapid.IntRange(0, 3).Draw(t, "from the calendar?") == 0 {
			cmd.FromCalendar, cmd.Seen = true, &calendar.Snapshot{Title: "edited", Start: cmd.Start, End: cmd.End}
		}
		return cmd
	},
	"sessions.delete": func(t *rapid.T, b *book.Book) command.Command {
		s := mPick(t, b.Sessions)
		if s == nil {
			return nil
		}
		return book.DeleteSession{ID: s.ID, KeepPackage: rapid.Bool().Draw(t, "keep package"), FromCalendar: rapid.Bool().Draw(t, "from the calendar")}
	},
	"sessions.saveRecord": func(t *rapid.T, b *book.Book) command.Command {
		if s := mPick(t, b.Sessions); s != nil {
			return record{ID: s.ID}
		}
		return nil
	},
	"calendar.together": func(t *rapid.T, b *book.Book) command.Command {
		s, o := mPick(t, b.Sessions), mPick(t, b.Sessions)
		if s == nil || o == nil || s.ID == o.ID {
			return nil
		}
		swap := func(s, o *sessions.Session) book.UpdateSession {
			bk := mDraftOf(b, s)
			bk.Start, bk.End = o.Start, o.Start.Add(s.End.Sub(s.Start))
			return book.UpdateSession{ID: s.ID, Booking: bk, FromCalendar: true, Seen: &calendar.Snapshot{Title: "swapped"}}
		}
		return book.Together{swap(s, o), swap(o, s)}
	},
	"packages.save": func(t *rapid.T, b *book.Book) command.Command {
		cmd := book.SavePackage{
			ClientID: mClient(t), Sessions: rapid.SampledFrom([]int{1, 5, 10}).Draw(t, "sessions"),
			PriceCents: rapid.SampledFrom([]int64{0, 40000, 85000}).Draw(t, "price"), PurchasedAt: mStart(t),
		}
		if p := mPick(t, b.Packages); p != nil && rapid.Bool().Draw(t, "edit one?") {
			cmd.ID, cmd.UpdatePayment = p.ID, rapid.Bool().Draw(t, "update payment")
			if rapid.Bool().Draw(t, "same client and day?") {
				cmd.ClientID, cmd.PurchasedAt = p.ClientID, p.PurchasedAt
			}
		} else {
			cmd.NewID = b.NewID()
			if rapid.Bool().Draw(t, "paid there and then?") {
				cmd.Paid = &money.Input{Method: money.MethodCash}
			}
		}
		return cmd
	},
	"packages.delete": func(t *rapid.T, b *book.Book) command.Command {
		if p := mPick(t, b.Packages); p != nil {
			return book.DeletePackage{ID: p.ID}
		}
		return nil
	},
	"packages.makeStandalone": func(t *rapid.T, b *book.Book) command.Command {
		if p := mPick(t, b.Packages); p != nil {
			return book.MakeStandalone{ID: p.ID}
		}
		return nil
	},
	"payments.set": func(t *rapid.T, b *book.Book) command.Command {
		var items []book.Item
		if s := mPick(t, b.Sessions); s != nil && rapid.Bool().Draw(t, "a session?") {
			items = append(items, book.Item{Kind: book.ItemSession, ID: s.ID})
		} else if p := mPick(t, b.Packages); p != nil {
			items = append(items, book.Item{Kind: book.ItemPackage, ID: p.ID})
		}
		if len(items) == 0 {
			return nil
		}
		cmd := book.SetPayment{Items: items}
		if rapid.IntRange(0, 3).Draw(t, "undo?") > 0 {
			cmd.Payment = &money.Input{Method: money.MethodCash}
		}
		return cmd
	},
	"documents.issue": func(t *rapid.T, b *book.Book) command.Command {
		if d := mPickWhere(t, b.Docs, func(d *documents.Document) bool { return d.Draft != nil }); d != nil {
			return book.Issue{ID: d.ID, Version: d.Version}
		}
		return nil
	},
	"documents.revise": func(t *rapid.T, b *book.Book) command.Command {
		if d := mPickWhere(t, b.Docs, func(d *documents.Document) bool { return d.Status == documents.StatusIssued }); d != nil {
			return book.Revise{ID: d.ID, Version: d.Version}
		}
		return nil
	},
	"documents.cancel": func(t *rapid.T, b *book.Book) command.Command {
		if d := mPick(t, b.Docs); d != nil {
			return book.Cancel{ID: d.ID, Version: d.Version, Reason: "Wrong"}
		}
		return nil
	},
	"documents.discardDraft": func(t *rapid.T, b *book.Book) command.Command {
		if d := mPick(t, b.Docs); d != nil {
			return book.DiscardDraft{ID: d.ID, Version: d.Version}
		}
		return nil
	},
	"documents.saveDraft": func(t *rapid.T, b *book.Book) command.Command {
		d := mPickWhere(t, b.Docs, func(d *documents.Document) bool { return d.Draft != nil && len(d.Draft.Lines) > 0 })
		if d == nil || d.Draft == nil || len(d.Draft.Lines) == 0 {
			return nil
		}
		content := *d.Draft
		content.Lines = slices.Clone(content.Lines)
		switch rapid.SampledFrom([]string{"amount", "description", "name", "date", "drop a line"}).Draw(t, "change") {
		case "amount":
			content.Lines[0].AmountCents = rapid.SampledFrom([]int64{0, 5000, 9500}).Draw(t, "amount")
		case "description":
			content.Lines[0].Description = "Physio, knee"
		case "name":
			content.Recipient.Name = "Jane S."
		case "date":
			content.Date = "2026-10-15"
		case "drop a line":
			content.Lines = content.Lines[1:]
		}
		return book.SaveDraft{ID: d.ID, Version: d.Version, Content: content}
	},
	"documents.moveLines": func(t *rapid.T, b *book.Book) command.Command {
		from := mPick(t, b.Docs)
		if from == nil || from.Draft == nil || len(from.Draft.Lines) == 0 {
			return nil
		}
		cmd := book.MoveLines{From: from.ID, LineIDs: []string{from.Draft.Lines[0].ID}}
		if to := mPick(t, b.Docs); to != nil && rapid.Bool().Draw(t, "onto another?") {
			cmd.To = to.ID
		}
		return cmd
	},
	"followUps.create": func(t *rapid.T, b *book.Book) command.Command {
		cmd := book.CreateFollowUp{ID: b.NewID(), FollowUpDraft: mFollowUp(t)}
		if s := mPick(t, b.Sessions); s != nil && rapid.Bool().Draw(t, "from a session?") {
			cmd.SessionID, cmd.ClientID = s.ID, s.ClientID
		}
		if rapid.IntRange(0, 3).Draw(t, "from the calendar?") == 0 {
			e := calendar.Event{ID: b.NewID(), Title: "!", AllDay: true, Date: "2026-10-15"}
			cmd.Event, cmd.SessionID = &e, ""
			if rapid.Bool().Draw(t, "unreadable?") {
				cmd.Problem = &book.Problem{Kind: book.Unmatched, Text: "who?", Name: "Zed", EventID: e.ID, FollowUp: true}
			}
		}
		return cmd
	},
	"followUps.update": func(t *rapid.T, b *book.Book) command.Command {
		if f := mPick(t, b.FollowUps); f != nil {
			return book.UpdateFollowUp{ID: f.ID, FollowUpDraft: mFollowUp(t)}
		}
		return nil
	},
	"followUps.setDone": func(t *rapid.T, b *book.Book) command.Command {
		if f := mPick(t, b.FollowUps); f != nil {
			return book.SetFollowUpDone{ID: f.ID, Done: f.DoneAt == nil}
		}
		return nil
	},
	"followUps.delete": func(t *rapid.T, b *book.Book) command.Command {
		if f := mPick(t, b.FollowUps); f != nil {
			return book.DeleteFollowUp{ID: f.ID, FromCalendar: rapid.Bool().Draw(t, "from the calendar")}
		}
		return nil
	},
}

// record is what sessions.saveRecord does to a session: outside the book,
// but what a calendar delete must keep.
type record struct{ ID string }

func (record) Action() string      { return "sessions.saveRecord" }
func (r record) Scope() book.Scope { return book.Scope{Sessions: []string{r.ID}} }
func (r record) Apply(b *book.Book) error {
	s, err := b.Session(r.ID)
	if err == nil {
		s.Record = &sessions.Record{Summary: "Seen", UpdatedAt: now}
	}
	return err
}

// mPick draws one of a map's values, in id order; nil when it is empty.
func mPick[V any](t *rapid.T, m map[string]*V) *V {
	return mPickWhere(t, m, func(*V) bool { return true })
}

// mPickWhere draws one of a map's values that keep accepts, sometimes any
// (a step it isn't at is refused, which is checked too).
func mPickWhere[V any](t *rapid.T, m map[string]*V, keep func(*V) bool) *V {
	var ids []string
	for _, id := range slices.Sorted(maps.Keys(m)) {
		if keep(m[id]) || rapid.IntRange(0, 9).Draw(t, "any?") == 0 {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	return m[rapid.SampledFrom(ids).Draw(t, "id")]
}

func mClient(t *rapid.T) string {
	return rapid.SampledFrom([]string{"jane", "bob", "kid"}).Draw(t, "client")
}

// mStart is a time over three days, on the hour, so sessions often meet.
func mStart(t *rapid.T) time.Time {
	return now.Truncate(time.Hour).Add(time.Duration(rapid.IntRange(-24, 48).Draw(t, "hour")) * time.Hour)
}

// mBooking draws a booking, for the client given when it is kept.
func mBooking(t *rapid.T, b *book.Book, clientID string) book.Booking {
	if clientID == "" || rapid.IntRange(0, 3).Draw(t, "another client?") == 0 {
		clientID = mClient(t)
	}
	start := mStart(t)
	bk := book.Booking{
		ClientID: clientID, Start: start, End: start.Add(time.Hour),
		Tentative: rapid.IntRange(0, 3).Draw(t, "tentative?") == 0,
		Location:  rapid.SampledFrom([]sessions.Location{sessions.LocationOwn, sessions.LocationVisit}).Draw(t, "location"),
		FeeCents:  rapid.SampledFrom([]*int64{nil, nil, cents(0), cents(9500)}).Draw(t, "fee"),
	}
	if rapid.IntRange(0, 4).Draw(t, "buys a package?") == 0 {
		bk.Package = &book.PackageSpec{Sessions: rapid.SampledFrom([]int{1, 5}).Draw(t, "package sessions"), PriceCents: 40000}
	}
	return bk
}

// mDraftOf is a session's booking as it is.
func mDraftOf(b *book.Book, s *sessions.Session) book.Booking {
	d := b.DraftOf(s)
	return book.Booking{ClientID: s.ClientID, Start: s.Start, End: s.End, Tentative: s.Tentative, Location: s.Location, FeeCents: d.FeeCents, Package: d.Package}
}

func mFollowUp(t *rapid.T) book.FollowUpDraft {
	d := book.FollowUpDraft{ClientID: mClient(t), Summary: rapid.SampledFrom([]string{"", "call"}).Draw(t, "summary")}
	if rapid.Bool().Draw(t, "all day?") {
		d.Date = "2026-10-16"
	} else {
		start := mStart(t)
		d.Start = &start
	}
	return d
}

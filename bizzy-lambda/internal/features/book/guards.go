package book

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/command"
	"bizzy-lambda/internal/shared/money"
)

// Transition is a command and what it does: the book before, and the copy
// it changed (Derived).
type Transition struct {
	Before, After *Book
	Cmd           Command
}

// Every action the book decides, for guards that watch them all.
var (
	bookingActions  = command.On(CreateSession{}, UpdateSession{}, DeleteSession{})
	packageActions  = command.On(SavePackage{}, DeletePackage{}, MakeStandalone{})
	documentActions = command.On(SaveDraft{}, Issue{}, Revise{}, DiscardDraft{}, Cancel{}, MoveLines{})
	allActions      = slices.Concat(bookingActions, packageActions, documentActions, command.On(SetPayment{}, RepriceDrafts{}))
	// titleActions read an event's title, or write one.
	titleActions = command.On(CreateSession{}, UpdateSession{}, CreateFollowUp{}, UpdateFollowUp{})
)

// Guards is the book's guard table, in the order its refusals are shown:
// what a command couldn't make sense of first, then what it would break.
// Each row judges the transition (what the command does), so a new command
// is held to every rule on the actions it shares. testdata/guards.md shows
// it as a table.
var Guards = command.Guards[Transition]{
	// What a calendar title or a booking can't say.
	{
		ID: "calendar-title-readable", On: titleActions,
		Why:   "An event's title is read before anything changes",
		Fails: func(t Transition, _ command.Command) bool { return t.problem(Unreadable) != nil },
		Say: func(t Transition, _ command.Command) (string, []command.Remedy) {
			p := t.problem(Unreadable)
			return p.Text, t.undoInCalendar(p)
		},
		Remedies: []string{"calendar.revert", "calendar.ignore"},
		Policy:   "the calendar changes only what its title clearly says",
	},
	{
		ID: "name-is-a-client", On: titleActions,
		Why:   "Every session and follow-up is a client's: a title names one of them",
		Fails: func(t Transition, _ command.Command) bool { return t.problem(Unmatched) != nil },
		Say: func(t Transition, _ command.Command) (string, []command.Remedy) {
			p := t.problem(Unmatched)
			var remedies []command.Remedy
			if c, ok := t.Before.Clients[p.Suggested]; ok {
				remedies = append(remedies, command.Remedy{Action: "clients.save", Target: c.ID, Label: fmt.Sprintf("Add %q as %s's calendar name", p.Name, c.Name)})
			}
			remedies = append(remedies, command.Remedy{Action: "clients.save", Label: fmt.Sprintf("Add %s as a client", p.Name)})
			return p.Text, append(remedies, t.undoInCalendar(p)...)
		},
		Remedies: []string{"clients.save", "calendar.revert", "calendar.ignore"},
		Policy:   "a session or follow-up belongs to a client",
	},
	{
		ID: "name-can-be-written", On: titleActions,
		Why:   "An event's title must read back as its client",
		Fails: func(t Transition, _ command.Command) bool { return t.problem(Unwritable) != nil },
		Say: func(t Transition, _ command.Command) (string, []command.Remedy) {
			p := t.problem(Unwritable)
			return p.Text, []command.Remedy{{Action: "clients.save", Target: p.ClientID, Label: "Rename the client"}}
		},
		Remedies: []string{"clients.save"},
		Policy:   "the calendar shows every session and follow-up in its syntax",
	},
	{
		ID: "fee-known", On: command.On(CreateSession{}, UpdateSession{}),
		Why:   "Something pays for every session: a fee, a credit, or the client's usual fee",
		Fails: func(t Transition, _ command.Command) bool { return t.problem(NoFee) != nil },
		Say: func(t Transition, _ command.Command) (string, []command.Remedy) {
			p := t.problem(NoFee)
			name := t.Before.Clients[p.ClientID].Name
			remedies := []command.Remedy{
				{Action: "clients.save", Target: p.ClientID, Label: fmt.Sprintf("Set %s's usual fee", name)},
				{Action: "packages.save", Target: p.ClientID, Label: fmt.Sprintf("Add a package for %s", name)},
			}
			return p.Text, append(remedies, t.undoInCalendar(p)...)
		},
		Remedies: []string{"clients.save", "packages.save", "calendar.revert", "calendar.ignore"},
		Protects: []string{"credit-with-invoice"},
	},
	{
		ID: "document-lifecycle", On: slices.Concat(documentActions, command.On(MakeStandalone{})),
		Why:   "A document takes its steps in order: drafted, issued, revised or cancelled",
		Fails: func(t Transition, _ command.Command) bool { return t.problem(Lifecycle) != nil },
		Say: func(t Transition, _ command.Command) (string, []command.Remedy) {
			return t.problem(Lifecycle).Text, nil
		},
		NoRemedy: "it isn't at that step",
		Policy:   "a document's lifecycle (see documents)",
	},

	// What a command would break.
	{
		ID: OverlapGuard, On: command.On(CreateSession{}, UpdateSession{}),
		Why: "She sees one client at a time: no two sessions overlap, whoever's they are",
		Fails: func(t Transition, _ command.Command) bool {
			_, ok := t.overlap()
			return ok
		},
		Say: func(t Transition, c command.Command) (string, []command.Remedy) {
			other, _ := t.overlap()
			name := t.After.Clients[other.ClientID].Name
			when := fmt.Sprintf("%s–%s", other.Start.In(t.After.Location).Format("Mon 2 Jan, 3:04pm"), other.End.In(t.After.Location).Format("3:04pm"))
			var remedies []command.Remedy
			if id := t.calendarEvent(c); id != "" {
				remedies = t.undoInCalendar(&Problem{EventID: id})
			}
			remedies = append(remedies, command.Remedy{Action: "sessions.update", Target: other.ID, Label: fmt.Sprintf("Move %s's session", name)})
			return fmt.Sprintf("That's when %s has a session (%s).", name, when), remedies
		},
		Remedies: []string{"calendar.revert", "calendar.ignore", "sessions.update"},
		Protects: []string{"sessions-never-overlap"},
	},
	{
		ID: "calendar-delete-keeps-the-record", On: command.On(DeleteSession{}),
		Why: "Deleting an event in the calendar never deletes what she recorded on its session",
		Fails: func(t Transition, c command.Command) bool {
			d := c.(DeleteSession)
			s, ok := t.Before.Sessions[d.ID]
			return d.FromCalendar && ok && s.HasRecord()
		},
		Say: func(t Transition, c command.Command) (string, []command.Remedy) {
			s := t.Before.Sessions[c.(DeleteSession).ID]
			return fmt.Sprintf("The session on %s was deleted in the calendar, but it has notes or files.", t.Before.day(s.Start)), []command.Remedy{
				{Action: "calendar.revert", Target: conflicts.Key(conflicts.SurfaceCalendar, s.Event.EventID), Label: "Put the event back"},
				{Action: "sessions.delete", Target: s.ID, Label: "Delete it with its notes"},
			}
		},
		Remedies: []string{"calendar.revert", "sessions.delete"},
		Policy:   "a calendar delete never loses her notes",
	},
	{
		ID: "delete-keeps-money", On: allActions,
		Why: "What was received for something is never deleted with it",
		Fails: func(t Transition, _ command.Command) bool {
			_, ok := t.deletedPaid()
			return ok
		},
		Say: func(t Transition, _ command.Command) (string, []command.Remedy) {
			src, _ := t.deletedPaid()
			remedies := []command.Remedy{{Action: "payments.set", Target: Key(string(src.Kind), src.ID), Label: "Undo the payment"}}
			if p, ok := t.Before.Packages[src.ID]; ok && src.Kind == documents.SourcePackage && p.BoughtIn != "" {
				remedies = append(remedies, command.Remedy{Action: "packages.makeStandalone", Target: p.ID, Label: "Keep it as a package on its own"})
			}
			return fmt.Sprintf("Undo the payment first: deleting %s would lose the record of it.", t.Before.describe(src)), remedies
		},
		Remedies: []string{"payments.set", "packages.makeStandalone"},
		Policy:   "money received is only undone on purpose",
	},
	{
		ID: "issued-documents-never-change", On: allActions,
		Why: "What an issued invoice or receipt says is final: a change goes through a new document",
		Fails: func(t Transition, _ command.Command) bool {
			_, ok := t.changedIssued()
			return ok
		},
		Say: func(t Transition, _ command.Command) (string, []command.Remedy) {
			d, _ := t.changedIssued()
			return fmt.Sprintf("%s is issued, and this would change what it says. Cancel it first, then try again.", d.Number),
				[]command.Remedy{{Action: "documents.cancel", Target: d.ID, Label: "Cancel " + d.Number}}
		},
		Remedies: []string{"documents.cancel"},
		Seams:    []string{"documents.creditNote", "documents.debitNote"},
		Protects: []string{"issued-documents-never-change"},
	},
	{
		ID: "sold-packages-keep-their-size", On: command.On(SavePackage{}, UpdateSession{}),
		Why: "How many sessions a package has is what was sold: once invoiced, it changes through a new invoice",
		Fails: func(t Transition, _ command.Command) bool {
			_, _, ok := t.resizedIssued()
			return ok
		},
		Say: func(t Transition, _ command.Command) (string, []command.Remedy) {
			was, d, _ := t.resizedIssued()
			return fmt.Sprintf("%s is issued for a package of %d sessions. Cancel it first, then change the package.", d.Number, was.Sessions),
				[]command.Remedy{{Action: "documents.cancel", Target: d.ID, Label: "Cancel " + d.Number}}
		},
		Remedies: []string{"documents.cancel"},
		Seams:    []string{"documents.creditNote", "documents.debitNote"},
		Protects: []string{"issued-documents-never-change"},
	},
	{
		ID: "revision-only-corrects", On: command.On(SaveDraft{}),
		Why: "A revision corrects what is printed, never what an issued document charges, to whom, or when",
		Fails: func(t Transition, c command.Command) bool {
			_, what := t.illegalRevision(c.(SaveDraft).ID)
			return what != ""
		},
		Say: func(t Transition, c command.Command) (string, []command.Remedy) {
			d, what := t.illegalRevision(c.(SaveDraft).ID)
			return fmt.Sprintf("%s is issued: %s stays as issued. Cancel it to change that.", d.Number, what),
				[]command.Remedy{{Action: "documents.cancel", Target: d.ID, Label: "Cancel " + d.Number}}
		},
		Remedies: []string{"documents.cancel"},
		Seams:    []string{"documents.creditNote", "documents.debitNote"},
		Protects: []string{"issued-documents-never-change"},
	},
	{
		ID: "invoice-once-confirmed", On: command.On(Issue{}, UpdateSession{}),
		Why: "An invoice is issued for confirmed sessions only",
		Fails: func(t Transition, _ command.Command) bool {
			_, _, ok := t.tentativeInvoiced()
			return ok
		},
		Say: func(t Transition, c command.Command) (string, []command.Remedy) {
			d, s, _ := t.tentativeInvoiced()
			if _, issuing := c.(Issue); issuing {
				return fmt.Sprintf("Confirm the session on %s before issuing its invoice.", t.After.day(s.Start)),
					[]command.Remedy{{Action: "sessions.update", Target: s.ID, Label: "Confirm it"}}
			}
			return fmt.Sprintf("%s is issued for this session, so it stays confirmed. Cancel the invoice first.", d.Number),
				[]command.Remedy{{Action: "documents.cancel", Target: d.ID, Label: "Cancel " + d.Number}}
		},
		Remedies: []string{"sessions.update", "documents.cancel"},
		Protects: []string{"tentative-with-issued-invoice"},
	},
	{
		ID: "settle-once-confirmed", On: command.On(SetPayment{}),
		Why: "A payment is recorded for a confirmed session",
		Fails: func(t Transition, c command.Command) bool {
			return t.tentativePaid(c.(SetPayment)) != ""
		},
		Say: func(t Transition, c command.Command) (string, []command.Remedy) {
			return "Confirm the session before recording its payment.",
				[]command.Remedy{{Action: "sessions.update", Target: t.tentativePaid(c.(SetPayment)), Label: "Confirm it"}}
		},
		Remedies: []string{"sessions.update"},
		Policy:   "a tentative session may not happen",
	},
	{
		ID: "pay-what-is-owed", On: command.On(SetPayment{}, SavePackage{}),
		Why:   "Only what is owed is paid: a credit or a fee of nothing leaves nothing to pay",
		Fails: func(t Transition, _ command.Command) bool { return t.problem(NothingDue) != nil },
		Say: func(t Transition, _ command.Command) (string, []command.Remedy) {
			return t.problem(NothingDue).Text, nil
		},
		NoRemedy: "nothing is owed",
		Protects: []string{"paid-nothing-due"},
	},
	{
		ID: "undo-before-free", On: allActions,
		Why: "Something made free owes nothing, so what was received for it is undone first",
		Fails: func(t Transition, _ command.Command) bool {
			_, ok := t.paidButFree()
			return ok
		},
		Say: func(t Transition, _ command.Command) (string, []command.Remedy) {
			src, _ := t.paidButFree()
			return fmt.Sprintf("Nothing would be owed on %s, but a payment is recorded for it. Undo the payment first.", t.After.describe(src)),
				[]command.Remedy{{Action: "payments.set", Target: Key(string(src.Kind), src.ID), Label: "Undo the payment"}}
		},
		Remedies: []string{"payments.set"},
		Protects: []string{"paid-nothing-due"},
	},
	{
		ID: "paid-in-full", On: allActions,
		Why: "What was received for something is what it costs: a change to one changes the other",
		Fails: func(t Transition, _ command.Command) bool {
			_, ok := t.unevenPayment()
			return ok
		},
		Say: func(t Transition, _ command.Command) (string, []command.Remedy) {
			src, _ := t.unevenPayment()
			paid, fee := t.After.paidFor(src)
			return fmt.Sprintf("%s was received for %s, which would cost %s. Undo the payment first, or update it with the change.",
					money.Format(paid), t.After.describe(src), money.Format(fee)),
				[]command.Remedy{{Action: "payments.set", Target: Key(string(src.Kind), src.ID), Label: "Undo the payment"}}
		},
		Remedies: []string{"payments.set"},
		Protects: []string{"paid-in-full"},
	},
	{
		ID: "fees-stay-invoiced", On: command.On(SaveDraft{}, MoveLines{}, DiscardDraft{}),
		Why: "Every fee and package is on an invoice, which says what it costs",
		Fails: func(t Transition, _ command.Command) bool {
			_, ok := t.uninvoiced()
			return ok
		},
		Say: func(t Transition, c command.Command) (string, []command.Remedy) {
			src, _ := t.uninvoiced()
			if _, discarding := c.(DiscardDraft); discarding {
				return fmt.Sprintf("This draft charges %s, so it goes when that does.", t.Before.describe(src)), nil
			}
			return fmt.Sprintf("%s stays on an invoice: move its line to another draft instead.", capitalize(t.Before.describe(src))), nil
		},
		NoRemedy: "move its line to another draft, or delete what it charges",
		Protects: []string{"credit-with-invoice", "invoiced"},
	},
	{
		ID: "credits-in-hand", On: slices.Concat(bookingActions, command.On(SavePackage{}, DeletePackage{})),
		Why: "A credit covers a session from a package of its client that still has it",
		Fails: func(t Transition, _ command.Command) bool {
			_, ok := t.brokenCredit()
			return ok
		},
		Say: func(t Transition, _ command.Command) (string, []command.Remedy) {
			b := t.brokenCredit
			pkg, _ := b()
			used := t.Before.Using(pkg)
			var remedies []command.Remedy
			if p, ok := t.Before.Packages[pkg]; ok && p.BoughtIn != "" {
				remedies = append(remedies, command.Remedy{Action: "packages.makeStandalone", Target: pkg, Label: "Keep it as a package on its own"})
			}
			if len(used) > 0 {
				remedies = append(remedies, command.Remedy{Action: "sessions.update", Target: used[0].ID, Label: "Change the session on " + t.Before.day(used[0].Start)})
			}
			return fmt.Sprintf("%d sessions use this package's credits, so it stays as it is for them.", max(len(used), 1)), remedies
		},
		Remedies: []string{"packages.makeStandalone", "sessions.update"},
		Protects: []string{"overdrawn", "credits-of-own-package"},
	},
	{
		ID: "bought-package-follows-its-session", On: command.On(SavePackage{}),
		Why: "A package bought in a session is that client's, bought that day",
		Fails: func(t Transition, c command.Command) bool {
			return t.strayBought(c.(SavePackage).ID)
		},
		Say: func(t Transition, c command.Command) (string, []command.Remedy) {
			p := t.Before.Packages[c.(SavePackage).ID]
			s := t.Before.Sessions[p.BoughtIn]
			return fmt.Sprintf("It was bought in the session on %s: change that session instead, or keep it as a package on its own.", t.Before.day(s.Start)),
				[]command.Remedy{
					{Action: "sessions.update", Target: s.ID, Label: "Change the session"},
					{Action: "packages.makeStandalone", Target: p.ID, Label: "Keep it as a package on its own"},
				}
		},
		Remedies: []string{"sessions.update", "packages.makeStandalone"},
		Protects: []string{"bought-in-its-session"},
	},
}

// What the guards look for in a transition. Each finds what the command
// broke, in a stable order, for the guard's message and remedies; the book
// before a command never has any of it (see invariants.go).

// problem is the first problem of a kind the command ran into.
func (t Transition) problem(kind ProblemKind) *Problem {
	for _, key := range SortedIDs(t.After.problems) {
		if p := t.After.problems[key]; p.Kind == kind {
			return &p
		}
	}
	return nil
}

// undoInCalendar is how she undoes, in the calendar, an edit that brought
// on a problem: write the session or follow-up back over it, or for a new
// event, say it isn't bizzy's.
func (t Transition) undoInCalendar(p *Problem) []command.Remedy {
	if p.EventID == "" {
		return nil
	}
	key := conflicts.Key(conflicts.SurfaceCalendar, p.EventID)
	for _, s := range t.Before.Sessions {
		if s.Event.EventID == p.EventID {
			return []command.Remedy{{Action: "calendar.revert", Target: key, Label: "Undo it in the calendar"}}
		}
	}
	for _, f := range t.Before.FollowUps {
		if f.Event.EventID == p.EventID {
			return []command.Remedy{{Action: "calendar.revert", Target: key, Label: "Undo it in the calendar"}}
		}
	}
	label := "Not a session"
	if p.FollowUp {
		label = "Not a follow-up"
	}
	return []command.Remedy{{Action: "calendar.ignore", Target: key, Label: label}}
}

// calendarEvent is the event a command is read from, when the calendar
// asked for it.
func (t Transition) calendarEvent(c command.Command) string {
	switch c := c.(type) {
	case CreateSession:
		if c.Event != nil {
			return c.Event.ID
		}
	case UpdateSession:
		if s, ok := t.Before.Sessions[c.ID]; ok && c.FromCalendar {
			return s.Event.EventID
		}
	}
	return ""
}

// overlap is a session another one the command books would overlap.
func (t Transition) overlap() (sessions.Session, bool) {
	for _, s := range booked(t.Before, t.After) {
		if other, ok := t.After.overlapping(s); ok {
			return other, true
		}
	}
	return sessions.Session{}, false
}

// overlapping is a session, of any client, that overlaps s.
func (b *Book) overlapping(s *sessions.Session) (sessions.Session, bool) {
	clash := func(o sessions.Session) bool {
		return o.ID != s.ID && o.Start.Before(s.End) && s.Start.Before(o.End)
	}
	for _, id := range SortedIDs(b.Sessions) {
		if o := *b.Sessions[id]; clash(o) {
			return o, true
		}
	}
	for _, id := range SortedIDs(b.Others) {
		// A loaded client's sessions are as they are in Sessions.
		if o := b.Others[id]; !b.Loaded[o.ClientID] && clash(o) {
			return o, true
		}
	}
	return sessions.Session{}, false
}

// resizedIssued is a package whose number of sessions the command changes
// while an issued invoice charges it: the package as it was, and the
// invoice.
func (t Transition) resizedIssued() (*packages.Package, *documents.Document, bool) {
	for _, id := range SortedIDs(t.After.Packages) {
		was, ok := t.Before.Packages[id]
		if !ok || was.Sessions == t.After.Packages[id].Sessions {
			continue
		}
		if l, ok := t.Before.line(packageSource(id), documents.TypeInvoice); ok && l.doc.Status == documents.StatusIssued {
			return was, l.doc, true
		}
	}
	return nil, nil, false
}

// items are every session and package of a book, as sources, in order.
func (b *Book) items() []documents.Source {
	var out []documents.Source
	for _, id := range SortedIDs(b.Sessions) {
		out = append(out, sessionSource(id))
	}
	for _, id := range SortedIDs(b.Packages) {
		out = append(out, packageSource(id))
	}
	return out
}

func (b *Book) has(src documents.Source) bool {
	if src.Kind == documents.SourcePackage {
		_, ok := b.Packages[src.ID]
		return ok
	}
	_, ok := b.Sessions[src.ID]
	return ok
}

// paidFor is what was received for an item, and what it costs.
func (b *Book) paidFor(src documents.Source) (paid, fee int64) {
	if src.Kind == documents.SourcePackage {
		p := b.Packages[src.ID]
		if p.Paid != nil {
			paid = p.Paid.AmountCents
		}
		return paid, p.PriceCents
	}
	s := b.Sessions[src.ID]
	if s.Paid != nil {
		paid = s.Paid.AmountCents
	}
	return paid, s.FeeCents
}

func (b *Book) isPaid(src documents.Source) bool {
	if src.Kind == documents.SourcePackage {
		return b.Packages[src.ID].Paid != nil
	}
	return b.Sessions[src.ID].Paid != nil
}

// deletedPaid is an item paid for that the command deletes.
func (t Transition) deletedPaid() (documents.Source, bool) {
	for _, src := range t.Before.items() {
		if t.Before.isPaid(src) && !t.After.has(src) {
			return src, true
		}
	}
	return documents.Source{}, false
}

// changedIssued is an issued document whose issued content the command
// changes, or that it deletes or voids, other than by issuing its next
// revision or cancelling it.
func (t Transition) changedIssued() (*documents.Document, bool) {
	for _, id := range SortedIDs(t.Before.Docs) {
		d := t.Before.Docs[id]
		if d.Status != documents.StatusIssued {
			continue
		}
		a, ok := t.After.Docs[id]
		switch {
		case !ok || a.Number != d.Number:
			return d, true
		case a.Status == documents.StatusCancelled:
			if c, cancelling := t.Cmd.(Cancel); !cancelling || c.ID != id {
				return d, true
			}
		case !sameJSON(a.Content, d.Content):
			if c, issuing := t.Cmd.(Issue); !issuing || c.ID != id {
				return d, true
			}
		}
	}
	return nil, false
}

// illegalRevision is what a revision drafted on an issued document changes
// that only a new document may (see documents.Legal); "" when nothing.
func (t Transition) illegalRevision(id string) (*documents.Document, string) {
	d, ok := t.After.Docs[id]
	if !ok || d.Number == "" || d.Draft == nil || d.Content == nil {
		return nil, ""
	}
	return d, documents.Legal(*d.Content, *d.Draft)
}

// tentativeInvoiced is an issued invoice covering a session that is
// tentative.
func (t Transition) tentativeInvoiced() (*documents.Document, *sessions.Session, bool) {
	for _, id := range SortedIDs(t.After.Docs) {
		d := t.After.Docs[id]
		if d.Status != documents.StatusIssued || d.Type != documents.TypeInvoice {
			continue
		}
		for _, src := range d.Sources {
			if s, ok := t.After.Sessions[src.ID]; ok && src.Kind == documents.SourceSession && s.Tentative {
				return d, s, true
			}
		}
	}
	return nil, nil, false
}

// tentativePaid is a tentative session a payment is recorded for.
func (t Transition) tentativePaid(c SetPayment) string {
	if c.Payment == nil {
		return ""
	}
	for _, it := range c.Items {
		if s, ok := t.After.Sessions[it.ID]; ok && it.Kind == ItemSession && s.Tentative {
			return s.ID
		}
	}
	return ""
}

// unevenPayment is an item for which what was received isn't what it
// costs.
func (t Transition) unevenPayment() (documents.Source, bool) {
	for _, src := range t.After.items() {
		if paid, fee := t.After.paidFor(src); t.After.isPaid(src) && paid != fee {
			return src, true
		}
	}
	return documents.Source{}, false
}

// paidButFree is an item a payment is recorded for that the command makes
// cost nothing.
func (t Transition) paidButFree() (documents.Source, bool) {
	for _, src := range t.After.items() {
		if _, fee := t.After.paidFor(src); t.After.isPaid(src) && fee == 0 {
			return src, true
		}
	}
	return documents.Source{}, false
}

// uninvoiced is an item that had an invoice and has none any more, though
// it still needs one: a package, or a session no credit covers.
func (t Transition) uninvoiced() (documents.Source, bool) {
	for _, src := range t.After.items() {
		if !t.Before.has(src) || !t.After.needsInvoice(src) || t.After.invoiced(src) || !t.Before.invoiced(src) {
			continue
		}
		return src, true
	}
	return documents.Source{}, false
}

func (b *Book) needsInvoice(src documents.Source) bool {
	return src.Kind == documents.SourcePackage || !b.Sessions[src.ID].OnCredit()
}

func (b *Book) invoiced(src documents.Source) bool {
	_, ok := b.line(src, documents.TypeInvoice)
	return ok
}

// brokenCredit is a package whose credits a command leaves wrong: a
// session uses a credit of one gone or another client's, or more sessions
// use it than it has.
func (t Transition) brokenCredit() (string, bool) {
	for _, id := range SortedIDs(t.After.Sessions) {
		s := t.After.Sessions[id]
		if !s.OnCredit() {
			continue
		}
		if p, ok := t.After.Packages[s.PackageID]; !ok || p.ClientID != s.ClientID {
			return s.PackageID, true
		}
	}
	for _, id := range SortedIDs(t.After.Packages) {
		if p := t.After.Packages[id]; len(t.After.Using(id)) > p.Sessions {
			return id, true
		}
	}
	return "", false
}

// strayBought reports whether a package bought in a session is changed to
// another client or day than the session's.
func (t Transition) strayBought(id string) bool {
	p, ok := t.After.Packages[id]
	before, was := t.Before.Packages[id]
	if !ok || !was || p.BoughtIn == "" {
		return false
	}
	return p.ClientID != before.ClientID || !p.PurchasedAt.Equal(before.PurchasedAt)
}

// describe names an item as a message does.
func (b *Book) describe(src documents.Source) string {
	if src.Kind == documents.SourcePackage {
		if p, ok := b.Packages[src.ID]; ok {
			return "the package bought on " + b.day(p.PurchasedAt)
		}
		return "the package"
	}
	if s, ok := b.Sessions[src.ID]; ok {
		return "the session on " + b.day(s.Start)
	}
	return "the session"
}

// day is a date as messages write it: "3 Oct".
func (b *Book) day(t time.Time) string {
	return t.In(b.Location).Format("2 Jan")
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func sameJSON(a, b any) bool {
	return slices.Equal(mustJSON(a), mustJSON(b))
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

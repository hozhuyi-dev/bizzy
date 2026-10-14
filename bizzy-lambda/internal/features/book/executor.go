package book

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/command"
	"bizzy-lambda/internal/platform/dynamo"
)

// Store reads books and commits changes to them.
type Store interface {
	// Load reads every client and the settings, and the items of the
	// clients given; with numbering, this year's document counters too.
	Load(ctx context.Context, clientIDs []string, numbering []string) (Loaded, error)
	// Owner is the client a session, package, document or follow-up
	// belongs to.
	Owner(ctx context.Context, kind, id string) (string, bool, error)
	// Booked lists every client's sessions starting in [from, to).
	Booked(ctx context.Context, from, to time.Time) ([]sessions.Session, error)
	// Counter is the last value of a counter (see SlotKey); 0 if none yet.
	Counter(ctx context.Context, key string) (int64, error)
	// Commit writes a change all or none, if nothing it read changed since;
	// dynamo.ErrConflict otherwise. A chunked change may be written in
	// several transactions.
	Commit(ctx context.Context, c Change) error
}

// Change is what a command writes: the items it changed, at the version
// read, those it deleted, and its effects.
type Change struct {
	Sessions      []sessions.Session
	SessionsGone  []sessions.Session
	Packages      []packages.Package
	PackagesGone  []packages.Package
	Docs          []documents.Document
	DocsGone      []documents.Document
	FollowUps     []followups.FollowUp
	FollowUpsGone []followups.FollowUp
	// Clients are those whose activity changed.
	Clients []clients.Client
	Effects
	// Chunked lets a store write it in several transactions: a re-derive,
	// whose items are each right on their own.
	Chunked bool
}

// Empty reports whether the change writes nothing.
func (c Change) Empty() bool {
	return len(c.Sessions)+len(c.SessionsGone)+len(c.Packages)+len(c.PackagesGone)+len(c.Docs)+len(c.DocsGone)+
		len(c.FollowUps)+len(c.FollowUpsGone)+len(c.Clients) == 0 &&
		len(c.Externals)+len(c.ExternalsGone)+len(c.ConflictsGone)+len(c.Revisions)+len(c.Counters)+len(c.Shares)+len(c.EventsGone)+len(c.Purged)+len(c.Rebooked) == 0
}

// Diff is what turns before into after.
func Diff(before, after *Book) Change {
	var c Change
	for _, id := range SortedIDs(after.Sessions) {
		if was, ok := before.Sessions[id]; !ok || !sameJSON(was, after.Sessions[id]) {
			c.Sessions = append(c.Sessions, *after.Sessions[id])
		}
	}
	for _, id := range SortedIDs(before.Sessions) {
		if _, ok := after.Sessions[id]; !ok {
			c.SessionsGone = append(c.SessionsGone, *before.Sessions[id])
		}
	}
	for _, id := range SortedIDs(after.Packages) {
		if was, ok := before.Packages[id]; !ok || !sameJSON(was, after.Packages[id]) {
			c.Packages = append(c.Packages, *after.Packages[id])
		}
	}
	for _, id := range SortedIDs(before.Packages) {
		if _, ok := after.Packages[id]; !ok {
			c.PackagesGone = append(c.PackagesGone, *before.Packages[id])
		}
	}
	for _, id := range SortedIDs(after.Docs) {
		if was, ok := before.Docs[id]; !ok || !sameJSON(was, after.Docs[id]) {
			c.Docs = append(c.Docs, *after.Docs[id])
		}
	}
	for _, id := range SortedIDs(before.Docs) {
		if _, ok := after.Docs[id]; !ok {
			c.DocsGone = append(c.DocsGone, *before.Docs[id])
		}
	}
	for _, id := range SortedIDs(after.FollowUps) {
		if was, ok := before.FollowUps[id]; !ok || !sameJSON(was, after.FollowUps[id]) {
			c.FollowUps = append(c.FollowUps, *after.FollowUps[id])
		}
	}
	for _, id := range SortedIDs(before.FollowUps) {
		if _, ok := after.FollowUps[id]; !ok {
			c.FollowUpsGone = append(c.FollowUpsGone, *before.FollowUps[id])
		}
	}
	for _, id := range SortedIDs(after.Loaded) {
		was, a := before.Clients[id], after.Clients[id]
		if !sameJSON(was.Activity, a.Activity) || !sameJSON(was.LastSessionAt, a.LastSessionAt) || !sameJSON(was.NextBookedAt, a.NextBookedAt) {
			c.Clients = append(c.Clients, a)
		}
	}
	c.Effects = after.Effects
	for _, key := range slotsBooked(before, after) {
		prev := before.Counters[key]
		c.Counters = append(c.Counters, documents.CounterBump{Key: key, Prev: prev, Next: prev + 1})
	}
	return c
}

// SlotKey is the counter of the sessions booked on a day (UTC): every
// change that books a session on the day moves it on, so two changes that
// would book overlapping sessions can't both commit (see schema).
func SlotKey(day string) string { return "slot#" + day }

// booked are the sessions a command books: new, or moved in time.
func booked(before, after *Book) []*sessions.Session {
	var out []*sessions.Session
	for _, id := range SortedIDs(after.Sessions) {
		s := after.Sessions[id]
		if was, ok := before.Sessions[id]; !ok || !was.Start.Equal(s.Start) || !was.End.Equal(s.End) {
			out = append(out, s)
		}
	}
	return out
}

// slotDays are the days (UTC) a session takes up.
func slotDays(s *sessions.Session) []string {
	var out []string
	last := s.End.UTC().Add(-time.Nanosecond).Format(time.DateOnly)
	for day := s.Start.UTC(); ; day = day.AddDate(0, 0, 1) {
		d := day.Format(time.DateOnly)
		out = append(out, d)
		if d >= last {
			return out
		}
	}
}

// slotsBooked are the slot counters of the days a command books on.
func slotsBooked(before, after *Book) []string {
	var keys []string
	for _, s := range booked(before, after) {
		for _, day := range slotDays(s) {
			keys = append(keys, SlotKey(day))
		}
	}
	slices.Sort(keys)
	return slices.Compact(keys)
}

// Executor runs commands: it loads the book they need, decides them,
// commits what they do, and hands what follows (writing the calendar,
// deleting files) to After.
type Executor struct {
	Store    Store
	Location *time.Location
	Now      func() time.Time
	NewID    func() string
	// After runs once a change is committed. Its failure is logged, not
	// returned: the change stands, and the next sync finishes what After
	// left (an event still to write is pending).
	After func(ctx context.Context, c Change) error
}

// maxAttempts bounds the retries when something the change read was
// written meanwhile (usually the sync): each attempt reads afresh.
const maxAttempts = 4

// Do runs a command, or returns why it was refused (see command.Err).
func (x Executor) Do(ctx context.Context, cmd Command) (*Book, error) {
	after, violations, err := x.Try(ctx, cmd)
	if err != nil {
		return nil, err
	}
	if len(violations) > 0 {
		return nil, command.Err(violations)
	}
	return after, nil
}

// Try runs a command: committed when no guard refuses it, else every
// violation and nothing changed.
func (x Executor) Try(ctx context.Context, cmd Command) (*Book, []command.Violation, error) {
	for attempt := 1; ; attempt++ {
		before, err := x.Load(ctx, cmd.Scope())
		if err != nil {
			return nil, nil, err
		}
		after, violations, err := x.decide(ctx, before, cmd)
		if err != nil || len(violations) > 0 {
			return after, violations, err
		}
		change := Diff(before, after)
		if change.Empty() {
			return after, nil, nil
		}
		err = x.Store.Commit(ctx, change)
		if errors.Is(err, dynamo.ErrConflict) && attempt < maxAttempts {
			continue
		}
		if err != nil {
			return nil, nil, err
		}
		x.after(ctx, change)
		return after, nil, nil
	}
}

// Judge decides a command as Try would, without committing it: what
// refuses it, if anything.
func (x Executor) Judge(ctx context.Context, cmd Command) ([]command.Violation, error) {
	before, err := x.Load(ctx, cmd.Scope())
	if err != nil {
		return nil, err
	}
	_, violations, err := x.decide(ctx, before, cmd)
	return violations, err
}

func (x Executor) after(ctx context.Context, c Change) {
	if x.After == nil {
		return
	}
	if err := x.After(ctx, c); err != nil {
		slog.ErrorContext(ctx, "after a change", "error", err)
	}
}

// decide decides a command on a book, with the other clients' sessions
// around the times it books (read after the days' slot counters, so a
// change booking next to them meanwhile makes the commit fail and retry).
func (x Executor) decide(ctx context.Context, before *Book, cmd Command) (*Book, []command.Violation, error) {
	after, violations, err := Decide(before, cmd)
	if err != nil || after == nil {
		return after, violations, err
	}
	slots := slotsBooked(before, after)
	if len(slots) == 0 {
		return after, violations, nil
	}
	for _, key := range slots {
		if before.Counters[key], err = x.Store.Counter(ctx, key); err != nil {
			return nil, nil, err
		}
	}
	for _, s := range booked(before, after) {
		// A session lasts at most 12 hours, so one overlapping s starts
		// less than 12 hours before it.
		around, err := x.Store.Booked(ctx, s.Start.Add(-maxSession), s.End)
		if err != nil {
			return nil, nil, err
		}
		for _, o := range around {
			if !before.Loaded[o.ClientID] {
				before.Others[o.ID] = o
			}
		}
	}
	return Decide(before, cmd)
}

// maxSession is how long a session may last.
const maxSession = 12 * time.Hour

// Decide applies a command to a copy of the book and judges what it does:
// the copy, and every guard that refuses it. A command whose result would
// break an invariant though no guard refused it is a bug, returned as an
// error rather than written.
func Decide(before *Book, cmd Command) (*Book, []command.Violation, error) {
	after := before.Clone()
	if err := cmd.Apply(after); err != nil {
		return nil, nil, err
	}
	after.Derive()
	if violations := judge(before, after, cmd); len(violations) > 0 {
		return after, violations, nil
	}
	if len(after.problems) > 0 {
		return nil, nil, fmt.Errorf("book: no guard on %s refused %v", cmd.Action(), after.problems)
	}
	if broken := after.Check(); len(broken) > 0 {
		return nil, nil, fmt.Errorf("book: %s would leave %v", cmd.Action(), broken)
	}
	return after, nil, nil
}

// judge is what the guards say of a transition: of a Together, each
// guard on each command's action judges the whole change.
func judge(before, after *Book, cmd Command) []command.Violation {
	return judgeWith(Guards, before, after, cmd)
}

func judgeWith(guards command.Guards[Transition], before, after *Book, cmd Command) []command.Violation {
	together, ok := cmd.(Together)
	if !ok {
		return guards.Decide(Transition{Before: before, After: after, Cmd: cmd}, cmd)
	}
	var out []command.Violation
	seen := map[string]bool{}
	for _, c := range together {
		for _, v := range guards.Decide(Transition{Before: before, After: after, Cmd: c}, c) {
			if key := v.Guard + "\x00" + v.Message; !seen[key] {
				seen[key] = true
				out = append(out, v)
			}
		}
	}
	return out
}

// DecideWith decides a command with every guard but off ("" for none),
// without checking the book after it: what the guard table alone lets
// through, to test the table (see command.Machine and machine_test.go).
func DecideWith(before *Book, cmd Command, off string) (*Book, []command.Violation, error) {
	after := before.Clone()
	if err := cmd.Apply(after); err != nil {
		return nil, nil, err
	}
	after.Derive()
	guards := slices.DeleteFunc(slices.Clone(Guards), func(g command.Guard[Transition]) bool { return g.ID == off })
	return after, judgeWith(guards, before, after, cmd), nil
}

// Broken lists what a change breaks: what the book says after it (Check),
// what the command couldn't make sense of yet did, and what the guards
// keep across a change: an issued document says what it said (a revision
// only corrects), money received is kept, a calendar delete keeps her
// notes, and a tentative session isn't paid for.
func Broken(before, after *Book, cmd Command) []string {
	out := after.Check()
	for _, key := range SortedIDs(after.problems) {
		out = append(out, fmt.Sprintf("%s: %s was let through", key, after.problems[key].Kind))
	}
	t := Transition{Before: before, After: after, Cmd: cmd}
	if d, ok := t.changedIssued(); ok {
		out = append(out, issuedNeverChange+": "+d.Number+" changed")
	}
	if p, d, ok := t.resizedIssued(); ok {
		out = append(out, fmt.Sprintf("%s: %s charges package %s, resized", issuedNeverChange, d.Number, p.ID))
	}
	for _, id := range SortedIDs(after.Docs) {
		was, ok := before.Docs[id]
		if d := after.Docs[id]; ok && was.Content != nil && d.Content != nil && d.Status == documents.StatusIssued {
			if what := documents.Legal(*was.Content, *d.Content); what != "" {
				out = append(out, fmt.Sprintf("%s: %s issued a revision changing %s", issuedNeverChange, d.Number, what))
			}
		}
	}
	if src, ok := t.deletedPaid(); ok {
		out = append(out, fmt.Sprintf("money received for %s %s was deleted", src.Kind, src.ID))
	}
	for _, id := range SortedIDs(before.Sessions) {
		s := before.Sessions[id]
		if _, kept := after.Sessions[id]; !kept && s.HasRecord() {
			if d, ok := cmd.(DeleteSession); ok && d.FromCalendar {
				out = append(out, "a calendar delete lost the notes of session "+id)
			}
		}
	}
	for _, id := range SortedIDs(after.Sessions) {
		if s, was := after.Sessions[id], before.Sessions[id]; s.Tentative && s.Paid != nil && (was == nil || was.Paid == nil) {
			out = append(out, "tentative session "+id+" was paid for")
		}
	}
	return out
}

// Load reads the book a scope needs: whole, the clients its items belong
// to, and those it names.
func (x Executor) Load(ctx context.Context, scope Scope) (*Book, error) {
	ids := slices.Clone(scope.Clients)
	owners := []struct {
		kind string
		ids  []string
	}{{"session", scope.Sessions}, {"package", scope.Packages}, {"document", scope.Documents}, {"followUp", scope.FollowUps}}
	for _, o := range owners {
		for _, id := range o.ids {
			owner, found, err := x.Store.Owner(ctx, o.kind, id)
			if err != nil {
				return nil, err
			}
			if found {
				ids = append(ids, owner)
			}
		}
	}
	slices.Sort(ids)
	ids = slices.Compact(slices.DeleteFunc(ids, func(id string) bool { return id == "" }))
	now := x.Now()
	var numbering []string
	if scope.Numbering {
		for _, docType := range []documents.Type{documents.TypeInvoice, documents.TypeReceipt} {
			numbering = append(numbering, documents.CounterKey(docType, now.In(x.Location)))
		}
	}
	l, err := x.Store.Load(ctx, ids, numbering)
	if err != nil {
		return nil, err
	}
	return New(l, now, x.Location, x.NewID), nil
}

// Rederive writes what each client's items copy as it is now, guarding
// nothing: after the settings change, after time passes (activity), and to
// repair after a request that died partway.
func (x Executor) Rederive(ctx context.Context, clientIDs ...string) error {
	for _, id := range clientIDs {
		for attempt := 1; ; attempt++ {
			before, err := x.Load(ctx, Scope{Clients: []string{id}})
			if err != nil {
				return err
			}
			after := before.Clone()
			after.Derive()
			change := Diff(before, after)
			if change.Empty() {
				break
			}
			change.Chunked = true
			err = x.Store.Commit(ctx, change)
			if errors.Is(err, dynamo.ErrConflict) && attempt < maxAttempts {
				continue
			}
			if err != nil {
				return err
			}
			x.after(ctx, change)
			break
		}
	}
	return nil
}

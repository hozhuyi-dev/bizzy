// Package googlesync keeps bizzy and her Google account in step. Google
// Calendar is where she sees her sessions and follow-ups and can change
// them, not where they are true: bizzy is. So the sync reads every change
// she made there as the command she means (event_reader.go), and the book
// decides it with the same guards as the app's: applied when allowed, else
// kept as a conflict on her to-do list (see internal/features/conflicts)
// until she undoes it there, restores the event, or does it the way the
// guards offer (each refusal's remedies). The other way, every change in
// bizzy is written to its event (event_writer.go).
//
// The sync also refreshes each client's copy of their Google contact
// (Google is where contact details are true). It re-reads a range of the
// calendar instead of using sync tokens, so running twice is harmless.
package googlesync

import (
	"context"
	"errors"
	"slices"
	"time"

	"bizzy-lambda/internal/features/book"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/command"
	"bizzy-lambda/internal/platform/dynamo"
)

// SyncWindow is how far back a run re-reads the calendar unless she picks
// the dates.
const SyncWindow = 60 * 24 * time.Hour

// Lookahead is how far ahead every run reads, whatever its range: bookings
// are sessions too, and an unconfirmed one goes on her to-do list a few
// days before it.
const Lookahead = 60 * 24 * time.Hour

// Range is the stretch of calendar a run re-reads. A zero From reads from
// the start of the calendar; a zero To reads up to Lookahead from now.
type Range struct {
	From time.Time
	To   time.Time
}

// Calendar is her sessions calendar, read and written.
type Calendar interface {
	EventSource
	Get(ctx context.Context, id string) (calendar.Event, error)
	Insert(ctx context.Context, in calendar.EventInput) (calendar.Event, error)
	Update(ctx context.Context, id, etag string, in calendar.EventInput) (calendar.Event, error)
	Restore(ctx context.Context, id string) (calendar.Event, error)
	Delete(ctx context.Context, id, etag string) error
}

// isSession reports whether a new event is a session: every timed event on
// her sessions calendar is one, except follow-ups.
func isSession(event calendar.Event) bool {
	return !event.AllDay && !event.Cancelled && !calendar.IsFollowUp(event.Title)
}

// isFollowUp reports whether a new event is a follow-up, timed or all-day.
func isFollowUp(event calendar.Event) bool {
	return !event.Cancelled && calendar.IsFollowUp(event.Title)
}

// EventSource lists events starting in [from, to); a zero from reads from
// the start of the calendar.
type EventSource interface {
	Events(ctx context.Context, from, to time.Time) ([]calendar.Event, error)
}

// ContactSource lists her Google contacts.
type ContactSource interface {
	List(ctx context.Context) ([]contacts.Person, error)
}

type ClientStore interface {
	List(ctx context.Context) ([]clients.Client, error)
	RefreshContact(ctx context.Context, id string, previous, next clients.Contact) (bool, error)
}

type SessionStore interface {
	Get(ctx context.Context, id string) (sessions.Session, bool, error)
	Save(ctx context.Context, s sessions.Session) (sessions.Session, error)
	ListByTime(ctx context.Context, from, to time.Time) ([]sessions.Session, error)
	ListPending(ctx context.Context) ([]sessions.Session, error)
}

type FollowUpStore interface {
	Get(ctx context.Context, id string) (followups.FollowUp, bool, error)
	Save(ctx context.Context, f followups.FollowUp) (followups.FollowUp, error)
	ListByTime(ctx context.Context, from, to time.Time) ([]followups.FollowUp, error)
	ListPending(ctx context.Context) ([]followups.FollowUp, error)
}

// ConflictStore keeps the conflicts and what each record shows.
type ConflictStore interface {
	Get(ctx context.Context, key string) (conflicts.Conflict, bool, error)
	ListOpen(ctx context.Context) ([]conflicts.Conflict, error)
	Save(ctx context.Context, c conflicts.Conflict) (conflicts.Conflict, error)
	Delete(ctx context.Context, key string) error
	External(ctx context.Context, surface conflicts.Surface, externalID string) (conflicts.External, bool, error)
	PutExternal(ctx context.Context, e conflicts.External) error
	DeleteExternal(ctx context.Context, surface conflicts.Surface, externalID string) error
}

type StatusStore interface {
	Put(ctx context.Context, run Run) error
	Get(ctx context.Context) (*Run, error)
}

// Syncer reads the calendar into bizzy and writes bizzy back to it.
type Syncer struct {
	// Calendar opens the calendar she chose in Settings.
	Calendar func(ctx context.Context) (Calendar, error)
	// Contacts may be nil, which skips refreshing clients' contact copies.
	Contacts  ContactSource
	Clients   ClientStore
	Sessions  SessionStore
	FollowUps FollowUpStore
	Conflicts ConflictStore
	Book      book.Executor
	Status    StatusStore
	// Location is her time zone, which all-day follow-ups fall in.
	Location *time.Location
	Now      func() time.Time
}

func (sy Syncer) Run(ctx context.Context, r Range) (Summary, error) {
	var summary Summary
	all, err := sy.Clients.List(ctx)
	if err != nil {
		return summary, err
	}
	now := sy.Now().UTC()
	from, to := r.From, now.Add(Lookahead)
	if !r.To.IsZero() && r.To.Before(to) {
		to = r.To
	}

	if err := sy.refreshContacts(ctx, all, now, &summary); err != nil {
		return summary, err
	}
	cal, err := sy.Calendar(ctx)
	if err != nil {
		return summary, err
	}
	events, err := cal.Events(ctx, from, to)
	if err != nil {
		return summary, err
	}
	// The events this run writes, read again rather than as listed, and
	// the edits it couldn't apply (see Recheck).
	ctx, wrote := withWritten(ctx)
	ctx = withRaised(ctx)

	seen := map[string]bool{}
	for _, e := range events {
		if e.Cancelled {
			// Deleted: read as gone below, if it showed anything.
			continue
		}
		switch {
		case isSession(e):
			summary.Sessions++
		case isFollowUp(e):
			summary.FollowUps++
		}
		seen[e.ID] = true
		if wrote[e.ID] {
			// Written since it was listed: the listing is out of date.
			if err := sy.Event(ctx, e.ID, &summary); err != nil {
				return summary, err
			}
			continue
		}
		if err := sy.read(ctx, cal, e, &summary); err != nil {
			return summary, err
		}
	}
	// What the range no longer shows: deleted, moved out of it, or no
	// longer an event the listing reads.
	shown, err := sy.shownBetween(ctx, from, to.Add(-time.Second))
	if err != nil {
		return summary, err
	}
	for _, id := range shown {
		if !seen[id] {
			if err := sy.Event(ctx, id, &summary); err != nil {
				return summary, err
			}
		}
	}
	// Edits refused only for the order this run read them in apply now,
	// and ones that only make sense together (two events swapped) at once.
	if err := sy.Recheck(ctx); err != nil {
		return summary, err
	}
	if err := sy.together(ctx, &summary); err != nil {
		return summary, err
	}
	if err := sy.tidyConflicts(ctx, cal); err != nil {
		return summary, err
	}
	if err := sy.PushPending(ctx); err != nil {
		return summary, err
	}
	if err := sy.refreshActivity(ctx, now); err != nil {
		return summary, err
	}
	if open, err := sy.Conflicts.ListOpen(ctx); err == nil {
		summary.Conflicts = len(open)
	} else {
		return summary, err
	}

	if sy.Status != nil {
		if err := sy.Status.Put(ctx, Run{At: now, Summary: summary}); err != nil {
			return summary, err
		}
	}
	return summary, nil
}

// shownBetween are the events of the sessions and follow-ups in a range.
func (sy Syncer) shownBetween(ctx context.Context, from, to time.Time) ([]string, error) {
	var ids []string
	ss, err := sy.Sessions.ListByTime(ctx, from, to)
	if err != nil {
		return nil, err
	}
	for _, s := range ss {
		if s.Event.EventID != "" {
			ids = append(ids, s.Event.EventID)
		}
	}
	fs, err := sy.FollowUps.ListByTime(ctx, from, to)
	if err != nil {
		return nil, err
	}
	for _, f := range fs {
		if f.Event.EventID != "" {
			ids = append(ids, f.Event.EventID)
		}
	}
	return ids, nil
}

// Event reads one event as the sync would: what it shows, changed or gone.
func (sy Syncer) Event(ctx context.Context, eventID string, summary *Summary) error {
	cal, err := sy.Calendar(ctx)
	if err != nil {
		return err
	}
	e, err := cal.Get(ctx, eventID)
	switch {
	case errors.Is(err, calendar.ErrGone) || (err == nil && e.Cancelled):
		return sy.gone(ctx, eventID, summary)
	case err != nil:
		return err
	}
	return sy.read(ctx, cal, e, summary)
}

// read takes one event in: a new session or follow-up, a change to the one
// it shows, or nothing new.
func (sy Syncer) read(ctx context.Context, cal Calendar, e calendar.Event, summary *Summary) error {
	ext, found, err := sy.Conflicts.External(ctx, conflicts.SurfaceCalendar, e.ID)
	if err != nil {
		return err
	}
	switch {
	case found && ext.Kind == conflicts.Ignored:
		return nil
	case found:
		return sy.change(ctx, ext, e, summary)
	case !isSession(e) && !isFollowUp(e):
		// An all-day event that isn't a follow-up: not bizzy's.
		return nil
	}
	if kind, id := writtenFor(e); id != "" {
		// Written by the app, which died before recording it: the item's,
		// unless it has an event of its own still. A copy of an event
		// (she duplicated it) carries the same id, and is new.
		link, ok, err := sy.linkOf(ctx, kind, id)
		if err != nil {
			return err
		}
		if ok {
			own, err := cal.Get(ctx, link.EventID)
			if link.EventID == "" || errors.Is(err, calendar.ErrGone) || (err == nil && own.Cancelled) {
				return sy.link(ctx, kind, id, e)
			}
			if err != nil {
				return err
			}
		}
	}
	b, err := sy.Book.Load(ctx, book.Scope{})
	if err != nil {
		return err
	}
	var cmd book.Command = readNew(b, sy.Book.NewID(), e)
	if isFollowUp(e) {
		cmd = readNewFollowUp(b, sy.Book.NewID(), e)
	}
	return sy.try(ctx, cmd, b, target{}, conflicts.KindNew, e.ID, &e, nil, summary)
}

// writtenFor is the item the app wrote an event for, from its private
// properties.
func writtenFor(e calendar.Event) (conflicts.ExternalKind, string) {
	if id := e.Private[calendar.PropFollowUp]; id != "" && isFollowUp(e) {
		return conflicts.ShowsFollowUp, id
	}
	if id := e.Private[calendar.PropSession]; id != "" && isSession(e) {
		return conflicts.ShowsSession, id
	}
	return "", ""
}

// linkOf is the event link of a session or follow-up, if it exists.
func (sy Syncer) linkOf(ctx context.Context, kind conflicts.ExternalKind, id string) (calendar.Link, bool, error) {
	if kind == conflicts.ShowsFollowUp {
		f, ok, err := sy.FollowUps.Get(ctx, id)
		return f.Event, ok, err
	}
	s, ok, err := sy.Sessions.Get(ctx, id)
	return s.Event, ok, err
}

// target is what an event shows, for a conflict over it.
type target struct {
	kind conflicts.ExternalKind
	id   string
}

// change applies her edit to the event of a session or follow-up, unless
// it is no edit.
func (sy Syncer) change(ctx context.Context, ext conflicts.External, e calendar.Event, summary *Summary) error {
	key := conflicts.Key(conflicts.SurfaceCalendar, e.ID)
	scope := book.Scope{Sessions: []string{ext.ID}}
	if ext.Kind == conflicts.ShowsFollowUp {
		scope = book.Scope{FollowUps: []string{ext.ID}}
	}
	b, err := sy.Book.Load(ctx, scope)
	if err != nil {
		return err
	}
	var cmd book.Command
	var seen *calendar.Snapshot
	switch ext.Kind {
	case conflicts.ShowsFollowUp:
		f, ok := b.FollowUps[ext.ID]
		if !ok {
			return nil
		}
		if seen = f.Event.Seen; seen != nil && calendar.NotedSnapshotOf(e).Same(*seen) {
			// As agreed: any conflict she had was undone there.
			return sy.Conflicts.Delete(ctx, key)
		}
		cmd = readFollowUpChange(b, f, e)
	default:
		s, ok := b.Sessions[ext.ID]
		if !ok {
			return nil
		}
		if seen = s.Event.Seen; seen != nil && calendar.SnapshotOf(e).Same(*seen) {
			return sy.Conflicts.Delete(ctx, key)
		}
		cmd = readChange(b, s, e)
	}
	return sy.try(ctx, cmd, b, target{ext.Kind, ext.ID}, conflicts.KindChanged, e.ID, &e, seen, summary)
}

// gone applies her deleting the event of a session or follow-up, unless it
// shows none.
func (sy Syncer) gone(ctx context.Context, eventID string, summary *Summary) error {
	ext, found, err := sy.Conflicts.External(ctx, conflicts.SurfaceCalendar, eventID)
	if err != nil {
		return err
	}
	if !found || ext.Kind == conflicts.Ignored {
		return sy.Conflicts.Delete(ctx, conflicts.Key(conflicts.SurfaceCalendar, eventID))
	}
	var cmd book.Command = book.DeleteSession{ID: ext.ID, FromCalendar: true}
	scope := book.Scope{Sessions: []string{ext.ID}}
	if ext.Kind == conflicts.ShowsFollowUp {
		cmd, scope = book.DeleteFollowUp{ID: ext.ID, FromCalendar: true}, book.Scope{FollowUps: []string{ext.ID}}
	}
	b, err := sy.Book.Load(ctx, scope)
	if err != nil {
		return err
	}
	var seen *calendar.Snapshot
	switch ext.Kind {
	case conflicts.ShowsFollowUp:
		f, ok := b.FollowUps[ext.ID]
		if !ok {
			return sy.Conflicts.DeleteExternal(ctx, conflicts.SurfaceCalendar, eventID)
		}
		seen = f.Event.Seen
	default:
		s, ok := b.Sessions[ext.ID]
		if !ok {
			return sy.Conflicts.DeleteExternal(ctx, conflicts.SurfaceCalendar, eventID)
		}
		seen = s.Event.Seen
	}
	return sy.try(ctx, cmd, b, target{ext.Kind, ext.ID}, conflicts.KindGone, eventID, nil, seen, summary)
}

// try runs a command read from the calendar: applied, or kept as a
// conflict over the event with everything that refused it.
//
// An edit already waiting, with the event as it was when it was refused,
// is only judged again, not applied: what made it allowed may have been
// done for another reason, so it waits as ready to apply until she says
// so (conflicts.apply). An edit refused in this same run (only for the
// order the run read the events in), and a new event, apply as soon as
// they can.
func (sy Syncer) try(ctx context.Context, cmd book.Command, b *book.Book, t target, kind conflicts.Kind, eventID string, now *calendar.Event, seen *calendar.Snapshot, summary *Summary) error {
	key := conflicts.Key(conflicts.SurfaceCalendar, eventID)
	c := conflicts.Conflict{
		Key: key, Surface: conflicts.SurfaceCalendar, ExternalID: eventID,
		Kind: kind, Seen: seen, Asks: asks(b, cmd),
	}
	if t.id != "" {
		c.TargetKind, c.TargetID = string(t.kind), t.id
		c.ClientID = b.ClientOf(t.kind, t.id)
	}
	if now != nil {
		snap := calendar.SnapshotOf(*now)
		if t.kind == conflicts.ShowsFollowUp || (t.id == "" && isFollowUp(*now)) {
			snap = calendar.NotedSnapshotOf(*now)
		}
		c.Now = &snap
	}
	if c.Asks == nil {
		c.Asks = []string{}
	}

	waiting, found, err := sy.Conflicts.Get(ctx, key)
	if err != nil {
		return err
	}
	if found && kind != conflicts.KindNew && waiting.Kind == kind && sameNow(waiting.Now, c.Now) && !raised(ctx, key) && !applying(ctx, key) {
		violations, err := sy.Book.Judge(ctx, cmd)
		if err != nil {
			return err
		}
		c.Violations = violations
		return sy.keep(ctx, c)
	}

	_, violations, err := sy.Book.Try(ctx, cmd)
	if err != nil {
		return err
	}
	if len(violations) == 0 {
		summary.Saved++
		return nil
	}
	c.Violations = violations
	markRaised(ctx, key, cmd)
	return sy.keep(ctx, c)
}

// together applies at once the edits this run raised that only another
// session in the way refuses (each in a slot another edit frees): two
// sessions swapped in the calendar move together, or not at all.
func (sy Syncer) together(ctx context.Context, summary *Summary) error {
	keys, _ := ctx.Value(raisedKeys{}).(map[string]book.Command)
	var cmds book.Together
	for _, key := range book.SortedIDs(keys) {
		c, found, err := sy.Conflicts.Get(ctx, key)
		if err != nil {
			return err
		}
		if found && len(c.Violations) > 0 && !slices.ContainsFunc(c.Violations, func(v command.Violation) bool { return v.Guard != book.OverlapGuard }) {
			cmds = append(cmds, keys[key])
		}
	}
	if len(cmds) < 2 {
		return nil
	}
	_, violations, err := sy.Book.Try(ctx, cmds)
	if err == nil && len(violations) == 0 {
		summary.Saved += len(cmds)
	}
	return err
}

func sameNow(a, b *calendar.Snapshot) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && a.Same(*b))
}

// keep stores a conflict, as first found but saying what is true now.
func (sy Syncer) keep(ctx context.Context, c conflicts.Conflict) error {
	if c.Violations == nil {
		c.Violations = []command.Violation{}
	}
	for attempt := 1; ; attempt++ {
		existing, found, err := sy.Conflicts.Get(ctx, c.Key)
		if err != nil {
			return err
		}
		c.At, c.Version = sy.Now().UTC(), 0
		if found {
			c.At, c.Version = existing.At, existing.Version
			if dynamo.Same(existing, c) {
				return nil
			}
		}
		_, err = sy.Conflicts.Save(ctx, c)
		if errors.Is(err, dynamo.ErrConflict) && attempt < 3 {
			continue
		}
		return err
	}
}

// tidyConflicts drops conflicts over records that no longer say anything
// to settle: a new event since deleted, or what an event showed since
// deleted.
func (sy Syncer) tidyConflicts(ctx context.Context, cal Calendar) error {
	open, err := sy.Conflicts.ListOpen(ctx)
	if err != nil {
		return err
	}
	for _, c := range open {
		stale := false
		switch c.Kind {
		case conflicts.KindNew:
			e, err := cal.Get(ctx, c.ExternalID)
			if err != nil && !errors.Is(err, calendar.ErrGone) {
				return err
			}
			stale = err != nil || (!isSession(e) && !isFollowUp(e))
		default:
			_, ok, err := sy.linkOf(ctx, conflicts.ExternalKind(c.TargetKind), c.TargetID)
			if err != nil {
				return err
			}
			stale = !ok
		}
		if stale {
			if err := sy.Conflicts.Delete(ctx, c.Key); err != nil {
				return err
			}
		}
	}
	return nil
}

// refreshActivity re-derives the clients whose sessions have started since
// the last run: what they earned, and their last and next sessions, move
// with time.
func (sy Syncer) refreshActivity(ctx context.Context, now time.Time) error {
	var since time.Time
	if sy.Status != nil {
		last, err := sy.Status.Get(ctx)
		if err != nil {
			return err
		}
		if last != nil {
			since = last.At
		}
	}
	started, err := sy.Sessions.ListByTime(ctx, since, now)
	if err != nil {
		return err
	}
	var ids []string
	seen := map[string]bool{}
	for _, s := range started {
		if !seen[s.ClientID] {
			seen[s.ClientID] = true
			ids = append(ids, s.ClientID)
		}
	}
	return sy.Book.Rederive(ctx, ids...)
}

// refreshContacts reads her contacts and refreshes each client's copy.
func (sy Syncer) refreshContacts(ctx context.Context, all []clients.Client, now time.Time, summary *Summary) error {
	if sy.Contacts == nil {
		return nil
	}

	people, err := sy.Contacts.List(ctx)
	if err != nil {
		return err
	}
	byResource := make(map[string]contacts.Person, len(people))
	for _, p := range people {
		byResource[p.ResourceName] = p
	}

	for _, client := range all {
		if client.Contact == nil {
			continue
		}
		previous := *client.Contact
		next := previous
		if p, ok := byResource[previous.ResourceName]; ok {
			next = p.Link(now)
		} else {
			// Deleted or merged in Google: keep the copy, so she can
			// recreate the contact from it.
			next.Missing = true
		}
		if next.SameDetails(previous) {
			continue
		}
		wrote, err := sy.Clients.RefreshContact(ctx, client.ID, previous, next)
		if err != nil {
			return err
		}
		if wrote {
			summary.Contacts++
		}
	}
	return nil
}

// Recheck reads again every edit waiting in the calendar, after a change
// in bizzy, so a conflict always says what the guards say of it now: one
// the change has made allowed is ready to apply (or applies, when it was
// refused in this same run, or is a new event), and one still refused
// says why as of now.
func (sy Syncer) Recheck(ctx context.Context) error {
	if ctx.Value(rechecking{}) != nil {
		// Applying a waiting edit is a change too: it is rechecked once.
		return nil
	}
	ctx = context.WithValue(ctx, rechecking{}, true)
	// Applying one can change what another says (a new session takes a
	// credit another edit would take back): again, until none changes.
	for range maxRechecks {
		open, err := sy.Conflicts.ListOpen(ctx)
		if err != nil {
			return err
		}
		for _, c := range open {
			if err := sy.Event(ctx, c.ExternalID, &Summary{}); err != nil {
				return err
			}
		}
		after, err := sy.Conflicts.ListOpen(ctx)
		if err != nil || dynamo.Same(struct{ C []conflicts.Conflict }{open}, struct{ C []conflicts.Conflict }{after}) {
			return err
		}
	}
	return nil
}

// maxRechecks bounds the passes of Recheck: each settles at least one
// conflict, so there are never more than a few.
const maxRechecks = 5

type rechecking struct{}

// written collects the events a run writes (see markWritten).
type written struct{}

func withWritten(ctx context.Context) (context.Context, map[string]bool) {
	ids := map[string]bool{}
	return context.WithValue(ctx, written{}, ids), ids
}

// markWritten notes an event bizzy wrote, for the run listing the calendar
// to read it again.
func markWritten(ctx context.Context, eventID string) {
	if ids, ok := ctx.Value(written{}).(map[string]bool); ok {
		ids[eventID] = true
	}
}

// raisedKeys collects the conflicts a run raised, with the command each
// asked for as last read (see try).
type raisedKeys struct{}

func withRaised(ctx context.Context) context.Context {
	return context.WithValue(ctx, raisedKeys{}, map[string]book.Command{})
}

func markRaised(ctx context.Context, key string, cmd book.Command) {
	if keys, ok := ctx.Value(raisedKeys{}).(map[string]book.Command); ok {
		keys[key] = cmd
	}
}

func raised(ctx context.Context, key string) bool {
	keys, _ := ctx.Value(raisedKeys{}).(map[string]book.Command)
	_, ok := keys[key]
	return ok
}

// applyingKey marks the conflict she asked to apply.
type applyingKey struct{}

func withApplying(ctx context.Context, key string) context.Context {
	return context.WithValue(ctx, applyingKey{}, key)
}

func applying(ctx context.Context, key string) bool {
	k, _ := ctx.Value(applyingKey{}).(string)
	return k == key
}

package googlesync

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"sync"
	"time"

	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
)

// item is a session or follow-up to write to its event.
type item struct {
	kind ItemKind
	id   string
}

// AfterCommit writes what a commit changed to the calendar: the Runner's
// After hook. Whatever a change shows in a title (a client's name, a fee
// on an invoice, a package bought) writes the items it shows in. A
// failure is logged and left for the next run.
//
// In a request, the writing waits for the request's end (txn.Scope), so
// an item that many of its commits change is written once, after the
// last. Waiting edits are tried again then too, once, if a commit outside
// the sync's own reading may have let them through.
func (s *Sync) AfterCommit(ctx context.Context, changes []txn.Change) {
	retry := !isReading(ctx) && unblocks(changes)
	scope := txn.ScopeOf(ctx)
	if scope == nil {
		s.push(ctx, changes, retry)
		return
	}
	q := scope.Value(queueKey{}, func() any {
		scope.AtEnd(func(ctx context.Context) {
			q := scope.Take(queueKey{}).(*queue)
			s.push(ctx, q.changes, q.retry)
		})
		return &queue{}
	}).(*queue)
	q.changes = append(q.changes, changes...)
	q.retry = q.retry || retry
}

// queue is what a request's commits left to write to the calendar.
type queue struct {
	changes []txn.Change
	retry   bool
}

type queueKey struct{}

// push writes what commits changed to the calendar, then tries the waiting
// edits again if retry.
func (s *Sync) push(ctx context.Context, changes []txn.Change, retry bool) {
	cal, err := s.current(ctx)
	if err != nil {
		// Not connected, or not synced with the calendar chosen yet,
		// whose first run writes everything.
		return
	}
	todo, err := txn.Read(ctx, s.Runner, func(tx *txn.Tx) (pushes, error) {
		items, gone, err := affected(tx, changes)
		return pushes{items: items, gone: gone}, err
	})
	if err != nil {
		slog.ErrorContext(ctx, "writing the calendar", "error", err)
		return
	}
	if err := s.writeMany(ctx, cal, todo.items); err != nil {
		slog.ErrorContext(ctx, "writing the calendar", "error", err)
	}
	slices.Sort(todo.gone)
	if err := s.removeMany(ctx, cal, slices.Compact(todo.gone)); err != nil {
		slog.ErrorContext(ctx, "removing events", "error", err)
	}
	if retry {
		if err := s.retryWaiting(reading(ctx), cal); err != nil {
			slog.ErrorContext(ctx, "trying the waiting edits again", "error", err)
		}
	}
}

// unblocks reports whether a commit changed what a waiting edit may have
// been refused for: a client (a name to match, a fee), a session (one in
// the way), a package or a document (an invoice issued, a payment).
func unblocks(changes []txn.Change) bool {
	for _, c := range changes {
		switch c.Kind {
		case clients.Clients.Name, sessions.Sessions.Name, followups.FollowUps.Name,
			packages.Packages.Name, documents.Documents.Name:
			return true
		}
	}
	return false
}

// pushes are items to write, and events to delete.
type pushes struct {
	items []item
	gone  []string
}

// affected are the items whose events a commit's changes may change, and
// the events to delete: those of items deleted or cancelled, or that show
// nothing.
func affected(tx *txn.Tx, changes []txn.Change) (items []item, gone []string, err error) {
	seen := map[item]bool{}
	add := func(kind ItemKind, id string) {
		if it := (item{kind, id}); id != "" && !seen[it] {
			seen[it] = true
			items = append(items, it)
		}
	}
	for _, c := range changes {
		switch c.Kind {
		case sessions.Sessions.Name, followups.FollowUps.Name:
			kind := KindSession
			if c.Kind == followups.FollowUps.Name {
				kind = KindFollowUp
			}
			if there, err := exists(tx, kind, c.ID); err != nil {
				return nil, nil, err
			} else if there {
				add(kind, c.ID)
			} else if l, err := LinkOf(tx, kind, c.ID); err != nil {
				return nil, nil, err
			} else if l != nil {
				gone = append(gone, l.EventID)
			}
		case clients.Clients.Name:
			ss, err := sessions.Sessions.OfClient(tx, c.ID)
			if err != nil {
				return nil, nil, err
			}
			for _, x := range ss {
				add(KindSession, x.ID)
			}
			fs, err := followups.FollowUps.OfClient(tx, c.ID)
			if err != nil {
				return nil, nil, err
			}
			for _, x := range fs {
				add(KindFollowUp, x.ID)
			}
		case packages.Packages.Name:
			// The session it was bought in shows it, before and after.
			add(KindSession, c.Ref)
			add(KindSession, c.WasRef)
		case documents.Documents.Name:
			d, ok, err := documents.Documents.Find(tx, c.ID)
			if err != nil {
				return nil, nil, err
			}
			if !ok || d.Counting() == nil {
				continue
			}
			for _, line := range d.Counting().Lines {
				switch {
				case line.Source == nil:
				case line.Source.Kind == documents.SourceSession:
					add(KindSession, line.Source.ID) // Its fee may show.
				default:
					// The price of a package shows in the session it was
					// bought in.
					if p, ok, err := packages.Packages.Find(tx, line.Source.ID); err != nil {
						return nil, nil, err
					} else if ok {
						add(KindSession, p.BoughtIn)
					}
				}
			}
		case Links.Name:
			l, ok, err := Links.Find(tx, c.ID)
			if err != nil || !ok {
				continue
			}
			if there, err := exists(tx, l.Kind, l.ItemID); err != nil {
				return nil, nil, err
			} else if there {
				add(l.Kind, l.ItemID)
			} else {
				gone = append(gone, l.EventID)
			}
		}
	}
	return items, gone, nil
}

// writeAll writes every item between two times whose event doesn't show
// it, and deletes the events there still to delete: what the last
// commits' writes left undone, or a new calendar's every item. It returns
// how many items and events it went over.
func (s *Sync) writeAll(ctx context.Context, cal calendar.Calendar, from, to time.Time) (int, error) {
	over := 0
	todo, err := txn.Read(ctx, s.Runner, func(tx *txn.Tx) (pushes, error) {
		var p pushes
		over = 0
		// Only those whose event doesn't show them yet (as write would
		// find), in this one read rather than one each.
		add := func(kind ItemKind, id string) error {
			over++
			if stale, err := unwritten(tx, kind, id); err != nil || !stale {
				return err
			}
			p.items = append(p.items, item{kind, id})
			return nil
		}
		ss, err := sessions.Sessions.Between(tx, from, to)
		if err != nil {
			return p, err
		}
		for _, x := range ss {
			if err := add(KindSession, x.ID); err != nil {
				return p, err
			}
		}
		fs, err := followups.FollowUps.Between(tx, from, to)
		if err != nil {
			return p, err
		}
		for _, x := range fs {
			if err := add(KindFollowUp, x.ID); err != nil {
				return p, err
			}
		}
		ls, err := Links.Between(tx, from, to)
		for _, l := range ls {
			if there, err := exists(tx, l.Kind, l.ItemID); err != nil {
				return p, err
			} else if !there {
				p.gone = append(p.gone, l.EventID)
			}
		}
		return p, err
	})
	if err != nil {
		return 0, err
	}
	if err := s.writeMany(ctx, cal, todo.items); err != nil {
		return 0, err
	}
	if err := s.removeMany(ctx, cal, todo.gone); err != nil {
		return 0, err
	}
	return over + len(todo.gone), nil
}

// unwritten reports whether write would write an item: it is there to
// show, and its event doesn't show it yet, or doesn't carry its id.
func unwritten(tx *txn.Tx, kind ItemKind, id string) (bool, error) {
	if there, err := exists(tx, kind, id); err != nil || !there {
		return false, err
	}
	l, err := LinkOf(tx, kind, id)
	if err != nil || l == nil || !l.Marked {
		return true, err
	}
	want, err := EventOf(tx, kind, id, &l.Seen)
	return !want.Same(l.Seen), err
}

// write makes one item's event show it (see writeMany).
func (s *Sync) write(ctx context.Context, cal calendar.Calendar, kind ItemKind, id string) error {
	return s.writeMany(ctx, cal, []item{{kind, id}})
}

// writing is one item's write: what its event should show, and what the
// calendar said once it was written.
type writing struct {
	item
	want    calendar.Snapshot
	link    *Link
	waiting bool
	written *calendar.Event
}

// recordBatch is how many writes one commit records: each may put a link
// and delete a conflict.
const recordBatch = table.MaxWrites / 2

// writeMany makes items' events show them and carry their ids
// (Link.Marked), unless one already does, or the user edited its event and
// the sync hasn't read the edit yet: it reads it first, and the edit may
// stand. An edit bizzy refused (a conflict) is written over: what bizzy
// changed since settles it.
//
// It works out every write in one read, calls Google for them Parallel at
// a time, and records what the events now show in as few commits as that
// takes. A write that fails is left for the next sync; writeMany returns
// the failures once it has recorded the rest.
func (s *Sync) writeMany(ctx context.Context, cal calendar.Calendar, items []item) error {
	todo, err := txn.Read(ctx, s.Runner, func(tx *txn.Tx) ([]*writing, error) {
		var todo []*writing
		for _, it := range items {
			w := &writing{item: it}
			found, err := exists(tx, it.kind, it.id)
			if err != nil {
				return nil, err
			}
			if !found {
				continue
			}
			if w.link, err = LinkOf(tx, it.kind, it.id); err != nil {
				return nil, err
			}
			var seen *calendar.Snapshot
			if w.link != nil {
				l := *w.link
				w.link, seen = &l, &l.Seen
				if _, w.waiting, err = conflicts.Conflicts.Find(tx, l.EventID); err != nil {
					return nil, err
				}
			}
			if w.want, err = EventOf(tx, it.kind, it.id, seen); err != nil {
				return nil, err
			}
			if w.link == nil || !w.link.Marked || !w.want.Same(w.link.Seen) {
				todo = append(todo, w)
			}
		}
		return todo, nil
	})
	if err != nil {
		return err
	}
	errs := make([]error, len(todo))
	s.each(len(todo), func(i int) { errs[i] = s.send(ctx, cal, todo[i]) })
	written := slices.DeleteFunc(todo, func(w *writing) bool { return w.written == nil })
	for batch := range slices.Chunk(written, recordBatch) {
		dups, err := s.record(ctx, batch)
		if err != nil {
			return errors.Join(append(errs, err)...)
		}
		for _, e := range dups {
			errs = append(errs, cal.Delete(ctx, e.ID, e.ETag))
			knownEvents(ctx, cal).forget(e.ID)
		}
	}
	return errors.Join(errs...)
}

// send calls Google for one write: a new event, or its event updated, as
// the request last saw it (event). It leaves written nil when there is
// nothing to write after all.
func (s *Sync) send(ctx context.Context, cal calendar.Calendar, w *writing) error {
	in := w.want.Input()
	in.Private = map[string]string{calendar.PropSession: w.id}
	if w.kind == KindFollowUp {
		in.Private = map[string]string{calendar.PropFollowUp: w.id}
	}
	var written calendar.Event
	if w.link == nil {
		e, err := cal.Insert(ctx, in)
		if err != nil {
			return err
		}
		written = e
	} else {
		e, err := s.event(ctx, cal, w.link.EventID)
		switch {
		case errors.Is(err, calendar.ErrGone) || (err == nil && e.Cancelled):
			return nil // Deleted there: the sync reads that.
		case err != nil:
			return err
		case !shows(w.kind, e).Same(w.link.Seen) && !w.waiting:
			return nil // An edit not read yet.
		}
		// Over the event as last seen: Google refuses it if it changed since.
		written, err = cal.Update(ctx, e.ID, e.ETag, in)
		if errors.Is(err, calendar.ErrChanged) {
			knownEvents(ctx, cal).forget(e.ID)
			return nil // Edited since: the sync reads it.
		}
		if err != nil {
			return err
		}
	}
	knownEvents(ctx, cal).put(written)
	w.written = &written
	return nil
}

// record keeps what written events now show, in one commit, and returns
// the events another request wrote for the same items first, to delete.
// Quiet: this commit writes nothing to the calendar.
func (s *Sync) record(ctx context.Context, ws []*writing) ([]calendar.Event, error) {
	return txn.Run(ctx, s.Runner.Quiet(), func(tx *txn.Tx) ([]calendar.Event, error) {
		var dups []calendar.Event
		for _, w := range ws {
			now := shows(w.kind, *w.written)
			l, ok, err := Links.Find(tx, w.written.ID)
			if err != nil {
				return nil, err
			}
			if ok {
				l.Seen, l.Marked = now, true
				if err := conflicts.Conflicts.Delete(tx, w.written.ID); err != nil {
					return nil, err
				}
				continue
			}
			other, err := LinkOf(tx, w.kind, w.id)
			switch {
			case err != nil:
				return nil, err
			case other != nil:
				dups = append(dups, *w.written) // Another request wrote its event first.
			default:
				if err := Links.Add(tx, &Link{EventID: w.written.ID, Kind: w.kind, ItemID: w.id, Seen: now, Marked: true}); err != nil {
					return nil, err
				}
			}
		}
		return dups, nil
	})
}

// each runs f for 0 to n-1, Parallel at a time: calls to Google, which
// take most of a write's time. One at a time, in order, when Parallel is
// 1 or less (the tests, whose fakes count on order).
func (s *Sync) each(n int, f func(i int)) {
	if s.Parallel <= 1 || n <= 1 {
		for i := range n {
			f(i)
		}
		return
	}
	var wg sync.WaitGroup
	slots := make(chan struct{}, s.Parallel)
	for i := range n {
		slots <- struct{}{}
		wg.Go(func() {
			defer func() { <-slots }()
			f(i)
		})
	}
	wg.Wait()
}

// removeMany deletes events that show nothing any more, Parallel at a
// time, then their links (and any edit waiting on them) in as few commits
// as that takes. One that fails is left for the next sync; removeMany
// returns the failures once it has recorded the rest.
func (s *Sync) removeMany(ctx context.Context, cal calendar.Calendar, eventIDs []string) error {
	errs := make([]error, len(eventIDs))
	s.each(len(eventIDs), func(i int) { errs[i] = s.deleteEvent(ctx, cal, eventIDs[i]) })
	var gone []string
	for i, id := range eventIDs {
		if errs[i] == nil {
			gone = append(gone, id)
		}
	}
	for batch := range slices.Chunk(gone, recordBatch) {
		_, err := txn.Run(ctx, s.Runner.Quiet(), func(tx *txn.Tx) (any, error) {
			for _, id := range batch {
				if err := conflicts.Conflicts.Delete(tx, id); err != nil {
					return nil, err
				}
				if err := Links.Delete(tx, id); err != nil {
					return nil, err
				}
			}
			return nil, nil
		})
		if err != nil {
			return errors.Join(append(errs, err)...)
		}
	}
	return errors.Join(errs...)
}

// deleteEvent deletes an event, as the request last saw it; one deleted
// already is as good.
func (s *Sync) deleteEvent(ctx context.Context, cal calendar.Calendar, eventID string) error {
	e, err := s.event(ctx, cal, eventID)
	switch {
	case errors.Is(err, calendar.ErrGone) || (err == nil && e.Cancelled):
		return nil
	case err != nil:
		return err
	}
	if err := cal.Delete(ctx, eventID, e.ETag); err != nil && !errors.Is(err, calendar.ErrGone) {
		return err
	}
	knownEvents(ctx, cal).forget(eventID)
	return nil
}

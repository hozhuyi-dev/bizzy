package googlesync

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
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
func (s *Sync) AfterCommit(ctx context.Context, changes []txn.Change) {
	cal, err := s.Calendar(ctx)
	if err != nil {
		return // Not connected: nothing to write to.
	}
	todo, err := txn.Read(ctx, s.Runner, func(tx *txn.Tx) (pushes, error) {
		items, gone, err := affected(tx, changes)
		return pushes{items: items, gone: gone}, err
	})
	if err != nil {
		slog.ErrorContext(ctx, "writing the calendar", "error", err)
		return
	}
	for _, it := range todo.items {
		if err := s.write(ctx, cal, it.kind, it.id); err != nil {
			slog.ErrorContext(ctx, "writing the calendar", "kind", it.kind, "id", it.id, "error", err)
		}
	}
	for _, eventID := range todo.gone {
		if err := s.removeEvent(ctx, cal, eventID); err != nil {
			slog.ErrorContext(ctx, "removing an event", "event", eventID, "error", err)
		}
	}
}

// pushes are items to write, and events to delete.
type pushes struct {
	items []item
	gone  []string
}

// affected are the items whose events a commit's changes may change, and
// the events to delete: those of deleted items, or that show nothing.
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
			if !c.Deleted {
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

// writeAll writes every item in the window whose event doesn't show it,
// and deletes the events still to delete: what the last commits' writes
// left undone.
func (s *Sync) writeAll(ctx context.Context, cal calendar.Calendar, now time.Time) error {
	from, to := now.Add(-Window), now.Add(Window)
	todo, err := txn.Read(ctx, s.Runner, func(tx *txn.Tx) (pushes, error) {
		var p pushes
		ss, err := sessions.Sessions.Between(tx, from, to)
		if err != nil {
			return p, err
		}
		for _, x := range ss {
			p.items = append(p.items, item{KindSession, x.ID})
		}
		fs, err := followups.FollowUps.Between(tx, from, to)
		if err != nil {
			return p, err
		}
		for _, x := range fs {
			p.items = append(p.items, item{KindFollowUp, x.ID})
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
		return err
	}
	for _, it := range todo.items {
		if err := s.write(ctx, cal, it.kind, it.id); err != nil {
			return err
		}
	}
	for _, id := range todo.gone {
		if err := s.removeEvent(ctx, cal, id); err != nil {
			return err
		}
	}
	return nil
}

// write makes an item's event show it, unless it already does, or the
// user edited the event and the sync hasn't read the edit yet: it reads
// it first, and the edit may stand. An edit bizzy refused (a conflict) is
// written over: what bizzy changed since settles it.
func (s *Sync) write(ctx context.Context, cal calendar.Calendar, kind ItemKind, id string) error {
	type plan struct {
		found   bool
		want    calendar.Snapshot
		link    *Link
		waiting bool
	}
	p, err := txn.Read(ctx, s.Runner, func(tx *txn.Tx) (plan, error) {
		var p plan
		var err error
		if p.found, err = exists(tx, kind, id); err != nil || !p.found {
			return p, err
		}
		if p.link, err = LinkOf(tx, kind, id); err != nil {
			return p, err
		}
		var seen *calendar.Snapshot
		if p.link != nil {
			l := *p.link
			p.link, seen = &l, &l.Seen
			if _, p.waiting, err = conflicts.Conflicts.Find(tx, l.EventID); err != nil {
				return p, err
			}
		}
		p.want, err = EventOf(tx, kind, id, seen)
		return p, err
	})
	switch {
	case err != nil:
		return err
	case !p.found, p.link != nil && p.want.Same(p.link.Seen):
		return nil
	}

	var written calendar.Event
	if p.link == nil {
		in := p.want.Input()
		in.Private = map[string]string{calendar.PropSession: id}
		if kind == KindFollowUp {
			in.Private = map[string]string{calendar.PropFollowUp: id}
		}
		if written, err = cal.Insert(ctx, in); err != nil {
			return err
		}
	} else {
		e, err := cal.Get(ctx, p.link.EventID)
		switch {
		case errors.Is(err, calendar.ErrGone) || (err == nil && e.Cancelled):
			return nil // Deleted there: the sync reads that.
		case err != nil:
			return err
		case !shows(kind, e).Same(p.link.Seen) && !p.waiting:
			return nil // An edit not read yet.
		}
		written, err = cal.Update(ctx, e.ID, e.ETag, p.want.Input())
		if errors.Is(err, calendar.ErrChanged) {
			return nil // Edited this instant: the sync reads it.
		}
		if err != nil {
			return err
		}
	}

	// Record what the event now shows. Quiet: this commit writes nothing
	// to the calendar.
	duplicate, err := txn.Run(ctx, s.Runner.Quiet(), func(tx *txn.Tx) (bool, error) {
		now := shows(kind, written)
		l, ok, err := Links.Find(tx, written.ID)
		if err != nil {
			return false, err
		}
		if ok {
			l.Seen = now
			return false, conflicts.Conflicts.Delete(tx, written.ID)
		}
		if other, err := LinkOf(tx, kind, id); err != nil || other != nil {
			return other != nil, err // Another request wrote its event first.
		}
		return false, Links.Add(tx, &Link{EventID: written.ID, Kind: kind, ItemID: id, Seen: now})
	})
	if err != nil {
		return err
	}
	if duplicate {
		return cal.Delete(ctx, written.ID, written.ETag)
	}
	return nil
}

// writeItem writes one item's event, opening the calendar.
func (s *Sync) writeItem(ctx context.Context, kind ItemKind, id string) error {
	cal, err := s.Calendar(ctx)
	if err != nil {
		return err
	}
	return s.write(ctx, cal, kind, id)
}

// removeEvent deletes an event that shows nothing any more, then its
// link.
func (s *Sync) removeEvent(ctx context.Context, cal calendar.Calendar, eventID string) error {
	e, err := cal.Get(ctx, eventID)
	switch {
	case errors.Is(err, calendar.ErrGone) || (err == nil && e.Cancelled):
	case err != nil:
		return err
	default:
		if err := cal.Delete(ctx, eventID, e.ETag); err != nil && !errors.Is(err, calendar.ErrGone) {
			return err
		}
	}
	_, err = txn.Run(ctx, s.Runner.Quiet(), func(tx *txn.Tx) (any, error) {
		if err := conflicts.Conflicts.Delete(tx, eventID); err != nil {
			return nil, err
		}
		return nil, Links.Delete(tx, eventID)
	})
	return err
}

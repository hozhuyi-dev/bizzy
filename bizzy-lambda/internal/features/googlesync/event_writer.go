package googlesync

import (
	"context"
	"errors"
	"slices"

	"bizzy-lambda/internal/features/book"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/sessions"
)

// Pushing: every session's and follow-up's event shows it as it is
// (book.Projection, book.FollowUpProjection). A change in bizzy marks the
// event pending; once the change is committed, its event is written,
// carrying the item's id so a sync finds it even if the app dies before
// recording the event. A pending event over which she has an edit waiting
// (a conflict) is left alone: it is written when she settles it.

// After is the book's After: what follows a committed change, in the
// calendar and the files.
func (sy Syncer) After(purge func(ctx context.Context, sessionID string) error) func(ctx context.Context, c book.Change) error {
	return func(ctx context.Context, c book.Change) error {
		for _, id := range c.EventsGone {
			if err := sy.deleteEvent(ctx, id); err != nil {
				return err
			}
		}
		if purge != nil {
			for _, id := range c.Purged {
				if err := purge(ctx, id); err != nil {
					return err
				}
			}
		}
		cal, err := sy.Calendar(ctx)
		if err != nil {
			return err
		}
		mode := func(id string) pushMode {
			if slices.Contains(c.Rebooked, id) {
				return pushRebooked
			}
			return pushPending
		}
		for _, s := range c.Sessions {
			if err := sy.push(ctx, cal, target{conflicts.ShowsSession, s.ID}, mode(s.ID)); err != nil {
				return err
			}
		}
		for _, f := range c.FollowUps {
			if err := sy.push(ctx, cal, target{conflicts.ShowsFollowUp, f.ID}, mode(f.ID)); err != nil {
				return err
			}
		}
		return sy.Recheck(ctx)
	}
}

// PushPending writes every event still to be written.
func (sy Syncer) PushPending(ctx context.Context) error {
	var targets []target
	ss, err := sy.Sessions.ListPending(ctx)
	if err != nil {
		return err
	}
	for _, s := range ss {
		targets = append(targets, target{conflicts.ShowsSession, s.ID})
	}
	fs, err := sy.FollowUps.ListPending(ctx)
	if err != nil {
		return err
	}
	for _, f := range fs {
		targets = append(targets, target{conflicts.ShowsFollowUp, f.ID})
	}
	if len(targets) == 0 {
		return nil
	}
	cal, err := sy.Calendar(ctx)
	if err != nil {
		return err
	}
	for _, t := range targets {
		if err := sy.push(ctx, cal, t, pushPending); err != nil {
			return err
		}
	}
	return nil
}

// pushMode is how a push treats an edit of hers on the event.
type pushMode int

const (
	// pushPending writes a pending event unless an edit of hers is
	// waiting there, which it reads first.
	pushPending pushMode = iota
	// pushRebooked writes over an edit of hers she was shown as a
	// conflict: she has since changed the item in the app, which settles
	// it. One not read yet is read first, as pushPending does.
	pushRebooked
	// pushRevert writes the item over whatever is there: she asked to
	// undo her edit.
	pushRevert
)

// shown is an item as its event should show it.
type shown struct {
	target
	link calendar.Link
	want calendar.Snapshot
	// snapshot reads an event as this kind of item's Seen.
	snapshot func(calendar.Event) calendar.Snapshot
	prop     string
}

// shownAs loads what an item's event should show; false when it is gone.
func (sy Syncer) shownAs(ctx context.Context, t target) (shown, bool, error) {
	if t.kind == conflicts.ShowsFollowUp {
		b, err := sy.Book.Load(ctx, book.Scope{FollowUps: []string{t.id}})
		if err != nil {
			return shown{}, false, err
		}
		f, ok := b.FollowUps[t.id]
		if !ok {
			return shown{}, false, nil
		}
		return shown{target: t, link: f.Event, want: b.FollowUpProjection(f), snapshot: calendar.NotedSnapshotOf, prop: calendar.PropFollowUp}, true, nil
	}
	b, err := sy.Book.Load(ctx, book.Scope{Sessions: []string{t.id}})
	if err != nil {
		return shown{}, false, err
	}
	s, ok := b.Sessions[t.id]
	if !ok {
		return shown{}, false, nil
	}
	return shown{target: t, link: s.Event, want: b.Projection(s), snapshot: calendar.SnapshotOf, prop: calendar.PropSession}, true, nil
}

// input is what writing the item's event sends: what it shows, and the
// item's id (over any a copied event carried).
func (it shown) input() calendar.EventInput {
	in := it.want.Input()
	in.Private = map[string]string{it.prop: it.id}
	return in
}

// push writes one item's event.
func (sy Syncer) push(ctx context.Context, cal Calendar, t target, mode pushMode) error {
	it, ok, err := sy.shownAs(ctx, t)
	if err != nil || !ok || (!it.link.Pending && mode == pushPending) {
		return err
	}
	if it.link.EventID == "" {
		e, err := cal.Insert(ctx, it.input())
		if err != nil {
			return err
		}
		markWritten(ctx, e.ID)
		return sy.link(ctx, t.kind, t.id, e)
	}

	key := conflicts.Key(conflicts.SurfaceCalendar, it.link.EventID)
	force := mode == pushRevert
	if !force {
		_, open, err := sy.Conflicts.Get(ctx, key)
		switch {
		case err != nil:
			return err
		case open && mode == pushRebooked:
			force = true
		case open, !it.link.Pending:
			return nil
		}
	}
	live, err := cal.Get(ctx, it.link.EventID)
	switch {
	case errors.Is(err, calendar.ErrGone) || (err == nil && live.Cancelled):
		if force {
			return sy.restore(ctx, cal, it)
		}
		// Deleted there meanwhile: that is her edit to read first.
		return sy.gone(ctx, it.link.EventID, &Summary{})
	case err != nil:
		return err
	}
	if !force && (it.link.Seen == nil || !it.snapshot(live).Same(*it.link.Seen)) {
		// Changed there meanwhile: read her edit first; it is written once
		// that settles.
		ext := conflicts.External{Surface: conflicts.SurfaceCalendar, ExternalID: live.ID, Kind: t.kind, ID: t.id}
		return sy.change(ctx, ext, live, &Summary{})
	}
	if it.snapshot(live).Same(it.want) && live.Private[it.prop] == it.id {
		return sy.seen(ctx, t, it.snapshot(live), live.ID)
	}
	e, err := cal.Update(ctx, live.ID, live.ETag, it.input())
	if err != nil {
		return err
	}
	markWritten(ctx, e.ID)
	return sy.seen(ctx, t, it.snapshot(e), e.ID)
}

// restore brings an item's deleted event back: from the trash, or as a new
// event (the trash keeps them about 30 days).
func (sy Syncer) restore(ctx context.Context, cal Calendar, it shown) error {
	e, err := cal.Restore(ctx, it.link.EventID)
	if errors.Is(err, calendar.ErrGone) {
		if e, err = cal.Insert(ctx, it.input()); err != nil {
			return err
		}
		markWritten(ctx, e.ID)
		return sy.link(ctx, it.kind, it.id, e)
	}
	if err != nil {
		return err
	}
	markWritten(ctx, e.ID)
	if !it.snapshot(e).Same(it.want) {
		if e, err = cal.Update(ctx, e.ID, e.ETag, it.input()); err != nil {
			return err
		}
	}
	return sy.seen(ctx, it.target, it.snapshot(e), e.ID)
}

// link records an item's new event, and what it shows, at once.
func (sy Syncer) link(ctx context.Context, kind conflicts.ExternalKind, id string, e calendar.Event) error {
	_, err := sy.Book.Do(ctx, book.LinkEvent{Kind: kind, ID: id, Event: e})
	if errors.Is(err, sessions.ErrGone) || errors.Is(err, followups.ErrGone) {
		return nil
	}
	return err
}

// seen records that an item's event shows it, as written.
func (sy Syncer) seen(ctx context.Context, t target, snap calendar.Snapshot, eventID string) error {
	var err error
	if t.kind == conflicts.ShowsFollowUp {
		_, err = followups.Update(ctx, sy.FollowUps, t.id, func(f *followups.FollowUp) error {
			f.Event.Seen, f.Event.Pending = &snap, false
			return nil
		})
	} else {
		_, err = sessions.Update(ctx, sy.Sessions, t.id, func(s *sessions.Session) error {
			s.Event.Seen, s.Event.Pending = &snap, false
			return nil
		})
	}
	if errors.Is(err, sessions.ErrGone) || errors.Is(err, followups.ErrGone) {
		return nil
	}
	if err != nil {
		return err
	}
	return sy.Conflicts.Delete(ctx, conflicts.Key(conflicts.SurfaceCalendar, eventID))
}

// deleteEvent deletes the event of an item deleted in the app.
func (sy Syncer) deleteEvent(ctx context.Context, eventID string) error {
	cal, err := sy.Calendar(ctx)
	if err != nil {
		return err
	}
	live, err := cal.Get(ctx, eventID)
	if err == nil {
		err = cal.Delete(ctx, eventID, live.ETag)
	}
	if errors.Is(err, calendar.ErrGone) {
		return nil
	}
	return err
}

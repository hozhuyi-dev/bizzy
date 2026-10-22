// Package fakecal is an in-memory Google Calendar. It behaves as Google
// does where bizzy depends on it: every write bumps the event's etag and
// its Updated time, a write against an older etag is refused, and a deleted
// event stays readable as cancelled.
//
// The calendar's own methods are bizzy's side; the User* methods are the
// user editing the calendar directly, as on a phone.
package fakecal

import (
	"cmp"
	"context"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"sync"
	"time"

	"bizzy-lambda/internal/calendar"
)

type Calendar struct {
	// Name is its id, and prefixes its events' ids so two calendars'
	// never meet; "" is "primary", with bare ids.
	Name string
	// Live are the events in the calendar; Trash the deleted ones.
	Live  []calendar.Event
	Trash []calendar.Event
	// Now is the calendar's clock, which stamps Updated.
	Now func() time.Time `json:"-"`
	// BeforeWrite, when set, runs before each of bizzy's writes.
	BeforeWrite func(op string) `json:"-"`
	ids         int
	// mu lets bizzy call it from many goroutines at once, as the sync
	// does with Parallel.
	mu sync.Mutex
}

var _ calendar.Calendar = (*Calendar)(nil)

func (f *Calendar) ID() string { return cmp.Or(f.Name, "primary") }

func (f *Calendar) Changed(_ context.Context, since, from, to time.Time) ([]calendar.Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	events := f.Live
	if !since.IsZero() {
		events = slices.Concat(f.Live, f.Trash)
	}
	var out []calendar.Event
	for _, e := range events {
		if (since.IsZero() || !e.Updated.Before(since)) && (from.IsZero() || end(e).After(from)) && (to.IsZero() || e.At().Before(to)) {
			out = append(out, clone(e))
		}
	}
	return out, nil
}

func (f *Calendar) Earliest(_ context.Context, before time.Time) (time.Time, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var first time.Time
	found := false
	for _, e := range f.Live {
		if at := e.At(); at.Before(before) && (!found || at.Before(first)) {
			first, found = at, true
		}
	}
	return first, found, nil
}

func (f *Calendar) Get(_ context.Context, id string) (calendar.Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if i := f.find(f.Live, id); i >= 0 {
		return clone(f.Live[i]), nil
	}
	if i := f.find(f.Trash, id); i >= 0 {
		return clone(f.Trash[i]), nil
	}
	return calendar.Event{}, calendar.ErrGone
}

func (f *Calendar) Insert(_ context.Context, in calendar.EventInput) (calendar.Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.beforeWrite("calendar.insert")
	e := calendar.Event{ID: f.newID()}
	write(&e, in)
	f.touch(&e)
	f.Live = append(f.Live, e)
	return clone(e), nil
}

func (f *Calendar) Update(_ context.Context, id, etag string, in calendar.EventInput) (calendar.Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.beforeWrite("calendar.update")
	i := f.find(f.Live, id)
	if i < 0 {
		return calendar.Event{}, calendar.ErrGone
	}
	if f.Live[i].ETag != etag {
		return calendar.Event{}, calendar.ErrChanged
	}
	write(&f.Live[i], in)
	f.touch(&f.Live[i])
	return clone(f.Live[i]), nil
}

func (f *Calendar) Delete(_ context.Context, id, etag string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.beforeWrite("calendar.delete")
	i := f.find(f.Live, id)
	if i < 0 {
		return calendar.ErrGone
	}
	if f.Live[i].ETag != etag {
		return calendar.ErrChanged
	}
	f.trash(i)
	return nil
}

// UserAdd is the user adding an event; it returns its id.
func (f *Calendar) UserAdd(title string, start, end time.Time) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	e := calendar.Event{ID: f.newID(), Title: title, Start: start.UTC(), End: end.UTC()}
	f.touch(&e)
	f.Live = append(f.Live, e)
	return e.ID
}

// UserAddAllDay is the user adding an all-day event; it returns its id.
func (f *Calendar) UserAddAllDay(title, date string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	e := calendar.Event{ID: f.newID(), Title: title, Date: date, AllDay: true}
	f.touch(&e)
	f.Live = append(f.Live, e)
	return e.ID
}

// UserEdit is the user changing an event.
func (f *Calendar) UserEdit(id string, edit func(e *calendar.Event)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if i := f.find(f.Live, id); i >= 0 {
		edit(&f.Live[i])
		f.touch(&f.Live[i])
	}
}

// UserDelete is the user deleting an event.
func (f *Calendar) UserDelete(id string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if i := f.find(f.Live, id); i >= 0 {
		f.trash(i)
	}
}

// UserCopy is the user duplicating an event, bizzy's hidden properties
// included, as Google's "Duplicate" does; it returns the copy's id.
func (f *Calendar) UserCopy(id string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	i := f.find(f.Live, id)
	if i < 0 {
		return ""
	}
	e := clone(f.Live[i])
	e.ID = f.newID()
	e.ETag = ""
	f.touch(&e)
	f.Live = append(f.Live, e)
	return e.ID
}

func (f *Calendar) newID() string {
	f.ids++
	if f.Name == "" {
		return fmt.Sprintf("ev%d", f.ids)
	}
	return fmt.Sprintf("%s-ev%d", f.Name, f.ids)
}

func (f *Calendar) trash(i int) {
	e := f.Live[i]
	e.Cancelled = true
	f.touch(&e)
	f.Live = slices.Delete(f.Live, i, i+1)
	f.Trash = append(f.Trash, e)
}

func (f *Calendar) touch(e *calendar.Event) {
	n, _ := strconv.Atoi(e.ETag)
	e.ETag = strconv.Itoa(n + 1)
	e.Updated = f.Now().UTC()
}

func (f *Calendar) find(events []calendar.Event, id string) int {
	return slices.IndexFunc(events, func(e calendar.Event) bool { return e.ID == id })
}

func (f *Calendar) beforeWrite(op string) {
	if f.BeforeWrite != nil {
		f.BeforeWrite(op)
	}
}

// write applies an input as Google's patch does.
func write(e *calendar.Event, in calendar.EventInput) {
	e.Title = in.Title
	e.Start, e.End, e.Date, e.AllDay = in.Start.UTC(), in.End.UTC(), in.Date, in.Date != ""
	if e.AllDay {
		e.Start, e.End = time.Time{}, time.Time{}
	}
	if in.Description != nil {
		e.Description = *in.Description
	}
	for k, v := range in.Private {
		if e.Private == nil {
			e.Private = map[string]string{}
		}
		e.Private[k] = v
	}
}

func end(e calendar.Event) time.Time {
	if e.AllDay {
		day, _ := time.Parse(time.DateOnly, e.Date)
		return day.AddDate(0, 0, 1)
	}
	return e.End
}

func clone(e calendar.Event) calendar.Event {
	e.Private = maps.Clone(e.Private)
	return e
}

// Package fakecal is an in-memory Google Calendar (googlesync.Calendar).
// Every write bumps the event's etag, and a write against an older one is
// refused, as Google does. Deleted events go to the trash, which Restore
// brings them back from.
package fakecal

import (
	"context"
	"fmt"
	"slices"
	"time"

	"bizzy-lambda/internal/features/calendar"
)

type Calendar struct {
	Live []calendar.Event
	// Trash holds deleted events.
	Trash []calendar.Event
	// inserted numbers new events.
	inserted int
}

// Events lists the live events starting in [from, to); a zero from reads
// from the start.
func (f *Calendar) Events(_ context.Context, from, to time.Time) ([]calendar.Event, error) {
	var out []calendar.Event
	for _, e := range f.Live {
		start := e.Start
		if e.AllDay {
			start, _ = time.Parse(time.DateOnly, e.Date)
		}
		if !start.Before(from) && start.Before(to) {
			out = append(out, e)
		}
	}
	return out, nil
}

// Find returns the index of a live event, or -1.
func (f *Calendar) Find(id string) int {
	return slices.IndexFunc(f.Live, func(e calendar.Event) bool { return e.ID == id })
}

func (f *Calendar) Get(_ context.Context, id string) (calendar.Event, error) {
	i := f.Find(id)
	if i < 0 {
		return calendar.Event{}, calendar.ErrGone
	}
	return f.Live[i], nil
}

// Write applies an input the way a patch does.
func Write(e *calendar.Event, in calendar.EventInput) {
	e.Title, e.ColorID = in.Title, in.ColorID
	e.Start, e.End, e.Date, e.AllDay = in.Start, in.End, in.Date, in.Date != ""
	if in.Description != nil {
		e.Description = *in.Description
	}
	if in.Private != nil {
		e.Private = in.Private
	}
}

func (f *Calendar) Insert(_ context.Context, in calendar.EventInput) (calendar.Event, error) {
	f.inserted++
	e := calendar.Event{ID: fmt.Sprintf("new%d", f.inserted), ETag: "1"}
	Write(&e, in)
	f.Live = append(f.Live, e)
	return e, nil
}

func (f *Calendar) Restore(_ context.Context, id string) (calendar.Event, error) {
	i := slices.IndexFunc(f.Trash, func(e calendar.Event) bool { return e.ID == id })
	if i < 0 {
		return calendar.Event{}, calendar.ErrGone
	}
	e := f.Trash[i]
	f.Trash = slices.Delete(f.Trash, i, i+1)
	f.Live = append(f.Live, e)
	return e, nil
}

func (f *Calendar) Update(_ context.Context, id, etag string, in calendar.EventInput) (calendar.Event, error) {
	i := f.Find(id)
	if i < 0 {
		return calendar.Event{}, calendar.ErrGone
	}
	e := &f.Live[i]
	if e.ETag != etag {
		return calendar.Event{}, calendar.ErrChanged
	}
	Write(e, in)
	e.ETag += "+"
	return *e, nil
}

func (f *Calendar) Delete(_ context.Context, id, etag string) error {
	i := f.Find(id)
	if i < 0 {
		return calendar.ErrGone
	}
	if f.Live[i].ETag != etag {
		return calendar.ErrChanged
	}
	f.Trash = append(f.Trash, f.Live[i])
	f.Live = slices.Delete(f.Live, i, i+1)
	return nil
}

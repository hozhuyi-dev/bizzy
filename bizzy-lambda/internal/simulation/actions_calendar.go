package simulation

import (
	"cmp"
	"context"
	"fmt"
	"maps"
	"slices"
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/features/calendar"
)

// calendarActions are edits made in Google Calendar itself, which the app
// only learns about at the next sync: the source of every contradiction.
var calendarActions = []Action{
	{Name: "calendar.add", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		start := when(t, w)
		in := calendar.EventInput{Title: sessionTitle(t), Start: start, End: start.Add(time.Hour)}
		if rapid.IntRange(0, 3).Draw(t, "follow-up?") == 0 {
			in.Title = followUpTitle(t)
			if rapid.Bool().Draw(t, "all day?") {
				in.Date, in.Start, in.End = start.In(kl).Format(time.DateOnly), time.Time{}, time.Time{}
			}
		}
		e, err := w.Calendar.Insert(context.Background(), in)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("calendar: added %s %q at %s", e.ID, e.Title, cmp.Or(e.Date, e.Start.Format(time.RFC3339)))
		outsideChange(w)
	}},
	{Name: "calendar.retitle", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		e := &w.Calendar.Live[pickEvent(t, w, nil)]
		followUp := calendar.IsFollowUp(e.Title) || e.AllDay
		if rapid.IntRange(0, 9).Draw(t, "the other kind?") == 0 {
			// A session's event retitled as a follow-up, or the other way.
			followUp = !followUp
		}
		if followUp {
			e.Title = followUpTitle(t)
		} else {
			e.Title = sessionTitle(t)
		}
		t.Logf("calendar: retitled %s %q", e.ID, e.Title)
		touched(e)
		outsideChange(w)
	}},
	{Name: "calendar.move", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		e := &w.Calendar.Live[pickEvent(t, w, func(e calendar.Event) bool { return !e.AllDay })]
		shift := time.Duration(rapid.SampledFrom([]int{-48, -2, 3, 24, 72}).Draw(t, "hours moved")) * time.Hour
		e.Start, e.End = e.Start.Add(shift), e.End.Add(shift)
		t.Logf("calendar: moved %s %q to %s", e.ID, e.Title, e.Start.Format(time.RFC3339))
		touched(e)
		outsideChange(w)
	}},
	{Name: "calendar.renote", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		e := &w.Calendar.Live[pickEvent(t, w, nil)]
		e.Description = rapid.SampledFrom([]string{"", "Bring the scan", "Parking at the back"}).Draw(t, "description")
		t.Logf("calendar: described %s %q as %q", e.ID, e.Title, e.Description)
		touched(e)
		outsideChange(w)
	}},
	{Name: "calendar.duplicate", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		// Google's Duplicate copies everything, bizzy's private properties
		// too; she usually moves the copy.
		e := w.Calendar.Live[pickEvent(t, w, nil)]
		e.ID, e.ETag = fmt.Sprintf("copy%d", len(w.Calendar.Live)+len(w.Calendar.Trash)), "1"
		for w.Calendar.Find(e.ID) >= 0 || slices.ContainsFunc(w.Calendar.Trash, func(x calendar.Event) bool { return x.ID == e.ID }) {
			e.ID += "+"
		}
		e.Private = maps.Clone(e.Private)
		if !e.AllDay {
			shift := time.Duration(rapid.SampledFrom([]int{0, 2, 24, 168}).Draw(t, "hours later")) * time.Hour
			e.Start, e.End = e.Start.Add(shift), e.End.Add(shift)
		}
		w.Calendar.Live = append(w.Calendar.Live, e)
		t.Logf("calendar: duplicated as %s %q at %s", e.ID, e.Title, cmp.Or(e.Date, e.Start.Format(time.RFC3339)))
		outsideChange(w)
	}},
	{Name: "calendar.swap", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		// Two bookings dragged into each other's times.
		timed := func(e calendar.Event) bool { return !e.AllDay && !calendar.IsFollowUp(e.Title) }
		i, j := pickEvent(t, w, timed), pickEvent(t, w, timed)
		if i == j {
			t.Skip("one event")
		}
		a, b := &w.Calendar.Live[i], &w.Calendar.Live[j]
		a.Start, a.End, b.Start, b.End = b.Start, b.Start.Add(a.End.Sub(a.Start)), a.Start, a.Start.Add(b.End.Sub(b.Start))
		t.Logf("calendar: swapped %s %q and %s %q", a.ID, a.Title, b.ID, b.Title)
		touched(a)
		touched(b)
		outsideChange(w)
	}},
	{Name: "calendar.recolor", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		// Colours are hers: bizzy reads nothing from them.
		e := &w.Calendar.Live[pickEvent(t, w, nil)]
		e.ColorID = rapid.SampledFrom([]string{"", "1", "5", "11"}).Draw(t, "colour")
		t.Logf("calendar: coloured %s %q %q", e.ID, e.Title, e.ColorID)
		touched(e)
		outsideChange(w)
	}},
	{Name: "calendar.delete", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		i := pickEvent(t, w, nil)
		t.Logf("calendar: deleted %s %q", w.Calendar.Live[i].ID, w.Calendar.Live[i].Title)
		w.Calendar.Trash = append(w.Calendar.Trash, w.Calendar.Live[i])
		w.Calendar.Live = slices.Delete(w.Calendar.Live, i, i+1)
		outsideChange(w)
	}},
	{Name: "calendar.emptyTrash", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		// Google keeps deleted events about 30 days.
		if len(w.Calendar.Trash) == 0 {
			t.Skip("nothing deleted")
		}
		t.Logf("calendar: emptied the trash")
		w.Calendar.Trash = nil
	}},
	{Name: "calendar.restore", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		if len(w.Calendar.Trash) == 0 {
			t.Skip("nothing deleted")
		}
		i := rapid.IntRange(0, len(w.Calendar.Trash)-1).Draw(t, "trashed event")
		t.Logf("calendar: restored %s %q", w.Calendar.Trash[i].ID, w.Calendar.Trash[i].Title)
		w.Calendar.Live = append(w.Calendar.Live, w.Calendar.Trash[i])
		w.Calendar.Trash = slices.Delete(w.Calendar.Trash, i, i+1)
		outsideChange(w)
	}},
}

// touched bumps an event's etag, as any edit in Google does.
func touched(e *calendar.Event) { e.ETag += "+" }

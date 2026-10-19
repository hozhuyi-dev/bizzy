package simulation

import (
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/calendar"
)

// titles are what the user types on a timed event: clients' names, with a
// fee, a package or a place, near misses, names of no client, follow-ups,
// and what the syntax can't read.
var titles = []string{
	"Jane Smith", "? Jane Smith", "jane smith 95", "Bob Lee 120", "? Bob Lee (V)", "Amy Tan", "Amy Tan (H) 5x100",
	"Zed Ong", "Kim Lee", "Jane S", "95", "! Jane Smith: call back",
}

// allDayTitles are what the user types on an all-day event.
var allDayTitles = []string{"! Jane Smith: call back", "! Bob Lee", "! Zed Ong", "Holiday"}

// calendarActions are the user editing the calendar directly.
var calendarActions = []Action{
	{Name: "calendar.add", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		start := startTime(t, w)
		w.Calendar.UserAdd(rapid.SampledFrom(titles).Draw(t, "title"), start, start.Add(length(t)))
		w.InSync = false
	}},
	{Name: "calendar.addAllDay", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		day := startTime(t, w).In(time.FixedZone("MYT", 8*3600)).Format(time.DateOnly)
		w.Calendar.UserAddAllDay(rapid.SampledFrom(allDayTitles).Draw(t, "title"), day)
		w.InSync = false
	}},
	{Name: "calendar.move", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		e := pickEvent(t, w)
		start := startTime(t, w)
		w.Calendar.UserEdit(e.ID, func(e *calendar.Event) {
			if e.AllDay {
				e.Date = start.Format(time.DateOnly)
				return
			}
			e.Start, e.End = start, start.Add(e.End.Sub(e.Start))
		})
		w.InSync = false
	}},
	{Name: "calendar.retitle", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		e := pickEvent(t, w)
		title := rapid.SampledFrom(titles).Draw(t, "title")
		w.Calendar.UserEdit(e.ID, func(e *calendar.Event) { e.Title = title })
		w.InSync = false
	}},
	{Name: "calendar.renote", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		e := pickEvent(t, w)
		w.Calendar.UserEdit(e.ID, func(e *calendar.Event) { e.Description = "Edited on the phone" })
		w.InSync = false
	}},
	{Name: "calendar.delete", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		w.Calendar.UserDelete(pickEvent(t, w).ID)
		w.InSync = false
	}},
	{Name: "calendar.duplicate", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		w.Calendar.UserCopy(pickEvent(t, w).ID)
		w.InSync = false
	}},
	// The user choosing the other calendar in Settings: the next sync
	// writes bizzy to it, and reads what is in it. The one left keeps what
	// it showed, for choosing it again.
	{Name: "calendar.switch", Actor: ActorCalendar, Run: func(t *rapid.T, w *World) {
		w.Calendar, w.Other = w.Other, w.Calendar
		w.InSync = false
	}},
}

func pickEvent(t *rapid.T, w *World) calendar.Event {
	if len(w.Calendar.Live) == 0 {
		t.Skip("no events")
	}
	return rapid.SampledFrom(w.Calendar.Live).Draw(t, "event")
}

// clockActions are time passing.
var clockActions = []Action{
	{Name: "clock.advance", Actor: ActorClock, Run: func(t *rapid.T, w *World) {
		w.Now = w.Now.Add(time.Duration(rapid.IntRange(1, 36).Draw(t, "hours")) * time.Hour)
		w.InSync = false
	}},
}

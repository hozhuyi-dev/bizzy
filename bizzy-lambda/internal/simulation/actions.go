package simulation

import (
	"slices"

	"pgregory.net/rapid"
)

// Actor is who changes the world.
type Actor string

const (
	// ActorUser calls the router, as the app does.
	ActorUser Actor = "user"
	// ActorCalendar edits the calendar directly, as the user can on a phone.
	ActorCalendar Actor = "calendar"
	// ActorClock moves time on.
	ActorClock Actor = "clock"
)

// Action is one thing an actor can do. A user action is named after the
// router mutation it calls, so the catalogue test can check every mutation
// is covered; the others are named "<actor>.<what>".
type Action struct {
	Name  string
	Actor Actor
	// Run draws its inputs from the world and does it. It skips (t.Skip)
	// when there is nothing to do it to.
	Run func(t *rapid.T, w *World)
	// Syncs says it reads the calendar, where the user's edits may be
	// refused: the one way a user action brings on conflicts.
	Syncs bool
}

// Catalogue is every action the simulation draws from.
func Catalogue() []Action {
	return slices.Concat(userActions, calendarActions, clockActions)
}

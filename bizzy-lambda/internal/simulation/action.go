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
	// ActorCalendar edits Google Calendar directly, as she can on her phone.
	ActorCalendar Actor = "calendar"
	// ActorContacts edits Google Contacts directly.
	ActorContacts Actor = "contacts"
	// ActorClock moves time on.
	ActorClock Actor = "clock"
)

// Action is one thing an actor can do. A user action is named after the
// router action it calls, so the catalogue test can check every mutation
// is covered; the others are named "<actor>.<what>".
type Action struct {
	Name  string
	Actor Actor
	// Run draws its inputs from the world and does it. It skips (t.Skip)
	// when there is nothing to do it to.
	Run func(t *rapid.T, w *World)
}

// Catalogue is every action the simulation draws from.
func Catalogue() []Action {
	return slices.Concat(userActions, calendarActions, contactsActions, clockActions)
}

// outsideChange marks the world out of sync with Google: the next sync has
// work to do.
func outsideChange(w *World) { w.InSync = false }

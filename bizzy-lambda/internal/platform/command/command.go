// Package command is how bizzy decides whether a change may happen.
//
// Every change to the business's state is a Command: from the app (a
// router mutation) or from outside (an edit in Google Calendar, read by the
// sync). Before a command is applied, a table of Guards decides it: each
// guard checks the commands it is On, and refuses with a Violation that
// says why and which Remedies would let it through. A command no guard
// refuses is applied; one any guard refuses changes nothing. The app shows
// the refusal with its remedies as buttons; the sync keeps it as a conflict
// on the to-do list, offering the same remedies.
//
// So the app never reaches a state its rules call impossible: the guards
// keep the invariants (statemodel's Impossible rules, and the links in
// internal/integrity), and each guard names the ones it keeps (Protects),
// or the business rule it is (Policy). Each feature's guard table is kept
// as a golden file (testdata/guards.md, see Table), so adding a validation
// shows in review as one row.
//
// The package knows nothing about bizzy's entities: B is whatever a
// feature's guards read to decide, e.g. one client's sessions, packages and
// documents.
package command

import (
	"bizzy-lambda/internal/platform/apperr"
)

// Command is one change someone asked for. Action names it as the router
// does, e.g. "sessions.reschedule", whether it came from the app or the
// calendar.
type Command interface {
	Action() string
}

// Remedy is an action that clears a refusal (see apperr.Remedy).
type Remedy = apperr.Remedy

// Violation is one guard refusing a command.
type Violation struct {
	Guard    string   `json:"guard"`
	Message  string   `json:"message"`
	Remedies []Remedy `json:"remedies"`
}

// Err is the error a refused command returns to the app: the first
// violation, as the app shows one at a time; nil when there is none.
func Err(violations []Violation) error {
	if len(violations) == 0 {
		return nil
	}
	v := violations[0]
	return apperr.Refused(v.Guard, v.Message, v.Remedies)
}

// On lists the actions of commands, for a guard's On: naming the command
// types rather than writing their actions keeps a typo from silently
// guarding nothing.
func On(commands ...Command) []string {
	out := make([]string, len(commands))
	for i, c := range commands {
		out[i] = c.Action()
	}
	return out
}

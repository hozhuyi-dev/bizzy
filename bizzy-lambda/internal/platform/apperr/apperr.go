// Package apperr holds the errors that are safe to show in the app. Any
// other error that reaches the router is logged and reported as internal.
package apperr

import (
	"errors"
	"fmt"
)

type Code string

const (
	CodeInvalid  Code = "invalid"
	CodeNotFound Code = "not_found"
	// CodeRefused is a rule saying no: the change would leave the business
	// in a state it must never be in. It carries the remedies that would let
	// it through.
	CodeRefused Code = "refused"
	// CodeConflict is something else changing at the same moment; trying
	// again usually works.
	CodeConflict Code = "conflict"
	// CodeDisconnected means Google access is missing or was revoked; the
	// app sends the user to Settings to connect again.
	CodeDisconnected Code = "disconnected"
)

type Error struct {
	Code     Code
	Message  string
	Remedies []Remedy
}

// Remedy is an action the user can take to clear a refusal, offered as a
// button beside the message.
type Remedy struct {
	// Action is the router action to call, e.g. "clients.create".
	Action string `json:"action"`
	// Target is the id it acts on, if any.
	Target string `json:"target,omitempty"`
	// Request is the action's request, as far as the remedy knows it, e.g.
	// {"name": "Jane"}: the app sends it, or opens the action's form with
	// it filled in.
	Request map[string]any `json:"request,omitempty"`
	// Ask is what the user fills in before Request is sent, the app's
	// word for it ("fee"): taken right there once it is.
	Ask   string `json:"ask,omitempty"`
	Label string `json:"label"`
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

// Refused is a change a rule turned down, with what would let it through.
func Refused(message string, remedies ...Remedy) *Error {
	return &Error{Code: CodeRefused, Message: message, Remedies: remedies}
}

func Invalid(format string, args ...any) *Error {
	return &Error{Code: CodeInvalid, Message: fmt.Sprintf(format, args...)}
}

func NotFound(format string, args ...any) *Error {
	return &Error{Code: CodeNotFound, Message: fmt.Sprintf(format, args...)}
}

func Conflict(format string, args ...any) *Error {
	return &Error{Code: CodeConflict, Message: fmt.Sprintf(format, args...)}
}

func Disconnected(format string, args ...any) *Error {
	return &Error{Code: CodeDisconnected, Message: fmt.Sprintf(format, args...)}
}

// Verdict is what an action would say now: allowed, or why not and what
// would let it through. A view carries one per action it offers (its
// `can`), from the action's own precondition, so the app shows only what
// the API would take.
type Verdict struct {
	OK       bool     `json:"ok"`
	Why      string   `json:"why,omitempty"`
	Remedies []Remedy `json:"remedies,omitempty"`
}

// VerdictOf is a precondition's answer as a verdict. An error that isn't
// one to show is returned as it is: the view fails, rather than say no.
func VerdictOf(err error) (Verdict, error) {
	var shown *Error
	switch {
	case err == nil:
		return Verdict{OK: true}, nil
	case errors.As(err, &shown):
		return Verdict{Why: shown.Message, Remedies: shown.Remedies}, nil
	}
	return Verdict{}, err
}

// Locks are the fields an update can't change now, by their path in its
// JSON ("clientId"; "lines.amountCents" for every line's), each with why
// and what would free it. A view carries them (`locked`), from the checks
// its update makes, so a form disables just those fields and says why. A
// field left out may change, though the update may still be refused for
// something else (an overlap).
type Locks map[string]Verdict

// LocksOf runs each field's check: a refusal locks it.
func LocksOf(checks map[string]error) (Locks, error) {
	out := Locks{}
	for field, check := range checks {
		v, err := VerdictOf(check)
		if err != nil {
			return nil, err
		}
		if !v.OK {
			out[field] = v
		}
	}
	return out, nil
}

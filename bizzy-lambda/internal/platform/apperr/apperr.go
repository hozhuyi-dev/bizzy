// Package apperr holds errors that are safe to show in the app. Anything
// else that reaches the router is logged and reported as internal.
package apperr

import "fmt"

type Code string

const (
	CodeInvalid  Code = "invalid"
	CodeNotFound Code = "not_found"
	CodeConflict Code = "conflict"
	// CodeDisconnected means Google access is missing or was revoked; the
	// app sends her to Settings to connect again.
	CodeDisconnected Code = "disconnected"
)

type Error struct {
	Code    Code
	Message string
	// Guard names the guard that refused the action (see platform/command),
	// and Remedies are the actions that would let it through; both empty
	// for an error no guard raised.
	Guard    string
	Remedies []Remedy
}

// Remedy is an action the user can take to clear a refusal, offered as a
// button beside the message.
type Remedy struct {
	// Action is the router action to call, e.g. "documents.cancel".
	Action string `json:"action"`
	// Target is what to call it on, e.g. a document's id.
	Target string `json:"target,omitempty"`
	Label  string `json:"label"`
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

// Refused is an action a guard turned down, with the remedies it offers.
func Refused(guard, message string, remedies []Remedy) *Error {
	return &Error{Code: CodeConflict, Message: message, Guard: guard, Remedies: remedies}
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

// Package apperr holds errors that are safe to show in the app. Anything
// else that reaches the router is logged and reported as internal.
package apperr

import "fmt"

type Code string

const (
	CodeInvalid  Code = "invalid"
	CodeNotFound Code = "not_found"
	CodeConflict Code = "conflict"
)

type Error struct {
	Code    Code
	Message string
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

func Invalid(format string, args ...any) *Error {
	return &Error{Code: CodeInvalid, Message: fmt.Sprintf(format, args...)}
}

func NotFound(format string, args ...any) *Error {
	return &Error{Code: CodeNotFound, Message: fmt.Sprintf(format, args...)}
}

func Conflict(format string, args ...any) *Error {
	return &Error{Code: CodeConflict, Message: fmt.Sprintf(format, args...)}
}

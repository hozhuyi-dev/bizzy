package sessions

import (
	"time"

	"bizzy-lambda/internal/platform/apperr"
)

// The preconditions of what she records on a session, which read the
// session alone. Everything that changes its booking or its money is a
// command of the book, decided by the book's guard table (see
// internal/features/book).

// CanRecord reports whether its summary and notes can be written: once it
// has started.
func (s Session) CanRecord(now time.Time) error {
	if s.Start.After(now) {
		return apperr.Conflict("Notes can be written once the session has started.")
	}
	return nil
}

// CanAttach reports whether files can be attached or removed: as for the
// notes, once it has started.
func (s Session) CanAttach(now time.Time) error {
	if s.Start.After(now) {
		return apperr.Conflict("Files can be attached once the session has started.")
	}
	return nil
}

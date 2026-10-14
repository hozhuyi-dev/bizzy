package statemodel

import (
	"errors"

	"bizzy-lambda/internal/platform/apperr"
)

// Verdict is a guard's answer as the app shows it: allowed, or why not and
// what would let it through. An entity's view carries one per action (its
// `can`), so the app shows or explains each action without re-deriving the
// guard.
type Verdict struct {
	OK  bool   `json:"ok"`
	Why string `json:"why,omitempty"`
	// Guard and Remedies are the refusing guard's (see platform/command).
	Guard    string          `json:"guard,omitempty"`
	Remedies []apperr.Remedy `json:"remedies,omitempty"`
}

// Check turns a guard's error into a verdict.
func Check(err error) Verdict {
	if err == nil {
		return Verdict{OK: true}
	}
	var appErr *apperr.Error
	if errors.As(err, &appErr) {
		return Verdict{Why: appErr.Message, Guard: appErr.Guard, Remedies: appErr.Remedies}
	}
	return Verdict{Why: err.Error()}
}

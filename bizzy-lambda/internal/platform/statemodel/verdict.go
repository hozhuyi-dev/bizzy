package statemodel

import (
	"errors"

	"bizzy-lambda/internal/platform/apperr"
)

// Verdict is a guard's answer as the app shows it: allowed, or why not. An
// entity's view carries one per action (its `can`), so the app shows or
// explains each action without re-deriving the guard.
type Verdict struct {
	OK  bool   `json:"ok"`
	Why string `json:"why,omitempty"`
}

// Check turns a guard's error into a verdict.
func Check(err error) Verdict {
	if err == nil {
		return Verdict{OK: true}
	}
	var appErr *apperr.Error
	if errors.As(err, &appErr) {
		return Verdict{Why: appErr.Message}
	}
	return Verdict{Why: err.Error()}
}

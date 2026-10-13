package expenses

import "bizzy-lambda/internal/platform/apperr"

// Guards are the preconditions of the mutations on an expense. Each returns
// the error shown to the user, or nil.

// ErrGone is an expense no longer stored.
var ErrGone = apperr.NotFound("This expense was deleted.")

// ErrChanged is an edit made against an older version.
var ErrChanged = apperr.Conflict("This expense was changed in another tab. Its latest version is shown; make your change again.")

// CanChange reports whether an edit made to the version she saw can be
// saved: not once it was saved again since.
func (e Expense) CanChange(version int) error {
	if e.Version != version {
		return ErrChanged
	}
	return nil
}

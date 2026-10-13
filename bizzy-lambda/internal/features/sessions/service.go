package sessions

import (
	"context"
	"errors"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
)

// Store is the part of the repository that Update and the handlers use.
type Store interface {
	Get(ctx context.Context, eventID string) (Session, bool, error)
	Save(ctx context.Context, s Session) (Session, error)
}

// ErrGone is a session no longer stored.
var ErrGone = apperr.NotFound("This session is no longer in the calendar.")

// Update applies change to the stored session and saves it. When something
// else wrote it in between (usually the sync), it reads it again and
// applies the change afresh.
func Update(ctx context.Context, s Store, eventID string, change func(*Session) error) (Session, error) {
	for attempt := 0; ; attempt++ {
		current, found, err := s.Get(ctx, eventID)
		if err != nil {
			return Session{}, err
		}
		if !found {
			return Session{}, ErrGone
		}
		if err := change(&current); err != nil {
			return Session{}, err
		}
		saved, err := s.Save(ctx, current)
		if errors.Is(err, dynamo.ErrConflict) && attempt < 3 {
			continue
		}
		return saved, err
	}
}

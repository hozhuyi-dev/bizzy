package followups

import (
	"context"
	"errors"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
)

// ErrGone is a follow-up no longer stored.
var ErrGone = apperr.NotFound("This follow-up was deleted.")

// Store reads and saves follow-ups one at a time.
type Store interface {
	Get(ctx context.Context, id string) (FollowUp, bool, error)
	Save(ctx context.Context, f FollowUp) (FollowUp, error)
}

// Update changes a stored follow-up, reading it afresh if it changed
// meanwhile.
func Update(ctx context.Context, s Store, id string, change func(*FollowUp) error) (FollowUp, error) {
	for attempt := 0; ; attempt++ {
		current, found, err := s.Get(ctx, id)
		if err != nil {
			return FollowUp{}, err
		}
		if !found {
			return FollowUp{}, ErrGone
		}
		if err := change(&current); err != nil {
			return FollowUp{}, err
		}
		saved, err := s.Save(ctx, current)
		if errors.Is(err, dynamo.ErrConflict) && attempt < 3 {
			continue
		}
		return saved, err
	}
}

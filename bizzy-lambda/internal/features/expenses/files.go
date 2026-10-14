package expenses

import (
	"context"
	"errors"
	"time"

	"bizzy-lambda/internal/platform/dynamo"
)

// Files is the expense as the owner of its receipts (see
// attachments.Owner). Files can be attached to any expense that exists.
type Files struct {
	Repo interface {
		Get(ctx context.Context, id string) (Expense, bool, error)
		Save(ctx context.Context, e Expense) (Expense, error)
	}
	Now func() time.Time
}

func (f Files) CanAttach(ctx context.Context, id string) error {
	_, found, err := f.Repo.Get(ctx, id)
	if err == nil && !found {
		return ErrGone
	}
	return err
}

func (f Files) Exists(ctx context.Context, id string) (bool, error) {
	_, found, err := f.Repo.Get(ctx, id)
	return found, err
}

// SetFiles records the count, retrying when the expense was saved in
// between.
func (f Files) SetFiles(ctx context.Context, id string, n int) error {
	for attempt := 0; ; attempt++ {
		e, found, err := f.Repo.Get(ctx, id)
		if err != nil {
			return err
		}
		if !found {
			return ErrGone
		}
		if e.Files == n {
			return nil
		}
		e.Files = n
		_, err = f.Repo.Save(ctx, e)
		if errors.Is(err, dynamo.ErrConflict) && attempt < 3 {
			continue
		}
		return err
	}
}

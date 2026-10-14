package sessions

import (
	"context"
	"time"
)

// Files is the session as the owner of the files attached to it (see
// attachments.Owner): they count as something she recorded, so deleting
// its event in the calendar never takes them with it.
type Files struct {
	Repo Store
	Now  func() time.Time
	// After runs once its files changed (see After).
	After After
}

func (f Files) CanAttach(ctx context.Context, id string) error {
	s, found, err := f.Repo.Get(ctx, id)
	if err != nil {
		return err
	}
	if !found {
		return ErrGone
	}
	return s.CanAttach(f.Now())
}

func (f Files) Exists(ctx context.Context, id string) (bool, error) {
	_, found, err := f.Repo.Get(ctx, id)
	return found, err
}

func (f Files) SetFiles(ctx context.Context, id string, n int) error {
	now := f.Now().UTC()
	_, err := Update(ctx, f.Repo, id, func(s *Session) error {
		if s.Files() == n {
			return nil
		}
		summary, hasNotes := "", false
		if s.Record != nil {
			summary, hasNotes = s.Record.Summary, s.Record.HasNotes
		}
		s.setRecord(summary, hasNotes, n, now)
		return nil
	})
	if err != nil || f.After == nil {
		return err
	}
	return f.After(ctx, id)
}

package sessions

import (
	"context"
	"time"
)

// Files is the session as the owner of the files attached to it (see
// attachments.Owner): they count as something she recorded, so a session
// with files is kept when its event leaves the calendar.
type Files struct {
	Repo Store
	Now  func() time.Time
}

func (f Files) CanAttach(ctx context.Context, eventID string) error {
	s, found, err := f.Repo.Get(ctx, eventID)
	if err != nil {
		return err
	}
	if !found {
		return ErrGone
	}
	return s.CanAttach(f.Now())
}

func (f Files) Exists(ctx context.Context, eventID string) (bool, error) {
	_, found, err := f.Repo.Get(ctx, eventID)
	return found, err
}

func (f Files) SetFiles(ctx context.Context, eventID string, n int) error {
	now := f.Now().UTC()
	_, err := Update(ctx, f.Repo, eventID, func(s *Session) error {
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
	return err
}

package googlesync

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
	"bizzy-lambda/internal/schema"
)

type statusRecord struct {
	dynamo.Keys
	Run
}

// StatusRepository keeps the last run, so the app can say when it synced.
type StatusRepository struct {
	store *dynamo.Store
}

func NewStatusRepository(store *dynamo.Store) StatusRepository {
	return StatusRepository{store: store}
}

func (r StatusRepository) Put(ctx context.Context, run Run) error {
	return r.store.Put(ctx, statusRecord{Keys: schema.SyncStatusKeys(), Run: run})
}

// Get returns nil before the first sync.
func (r StatusRepository) Get(ctx context.Context) (*Run, error) {
	var rec statusRecord
	keys := schema.SyncStatusKeys()
	found, err := r.store.Get(ctx, keys.PK, keys.SK, &rec)
	if err != nil || !found {
		return nil, err
	}
	return &rec.Run, nil
}

// Register serves the sync and its last run. The app runs it on load and
// whenever she taps "Sync now".
func Register(r *router.Router, repo StatusRepository, loc *time.Location, run func(ctx context.Context, r Range) (Summary, error)) {
	r.Register("sync.status", func(ctx context.Context, _ json.RawMessage) (any, error) {
		return repo.Get(ctx)
	})
	r.Register("sync.run", router.Typed(func(ctx context.Context, in RunInput) (any, error) {
		rng, err := in.Range(loc, time.Now())
		if err != nil {
			return nil, err
		}
		summary, err := run(ctx, rng)
		if err == nil {
			slog.InfoContext(ctx, "calendar sync", "range", in, "summary", summary)
			return summary, nil
		}

		// Recorded so the app shows why, including for the sync on load.
		message := "The sync failed. Please try again."
		var appErr *apperr.Error
		if errors.As(err, &appErr) {
			message = appErr.Message
		}
		if putErr := repo.Put(ctx, Run{At: time.Now().UTC(), Error: message}); putErr != nil {
			slog.ErrorContext(ctx, "record sync failure", "error", putErr)
		}
		return nil, err
	}))
}

// RunInput is the dates she picked, both included, in her time zone. With
// neither, the run covers the last SyncWindow; All reads the whole calendar.
type RunInput struct {
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`
	All  bool   `json:"all,omitempty"`
}

func (in RunInput) Range(loc *time.Location, now time.Time) (Range, error) {
	switch {
	case in.All:
		return Range{}, nil
	case in.From == "" && in.To == "":
		return Range{From: now.Add(-SyncWindow)}, nil
	}

	from, err := time.ParseInLocation(time.DateOnly, in.From, loc)
	if err != nil {
		return Range{}, apperr.Invalid("pick a start date")
	}
	if in.To == "" {
		return Range{From: from}, nil
	}
	to, err := time.ParseInLocation(time.DateOnly, in.To, loc)
	if err != nil {
		return Range{}, apperr.Invalid("pick an end date")
	}
	if to.Before(from) {
		return Range{}, apperr.Invalid("the end date is before the start date")
	}
	return Range{From: from, To: to.AddDate(0, 0, 1)}, nil
}

package googlesync

import (
	"context"

	"bizzy-lambda/internal/platform/dynamo"
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

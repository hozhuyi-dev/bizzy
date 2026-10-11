package calsync

import (
	"context"
	"encoding/json"

	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

const (
	statusPartition = "SYNC"
	statusSortKey   = "LAST"
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
	return r.store.Put(ctx, statusRecord{Keys: dynamo.Keys{PK: statusPartition, SK: statusSortKey}, Run: run})
}

// Get returns nil before the first sync.
func (r StatusRepository) Get(ctx context.Context) (*Run, error) {
	var rec statusRecord
	found, err := r.store.Get(ctx, statusPartition, statusSortKey, &rec)
	if err != nil || !found {
		return nil, err
	}
	return &rec.Run, nil
}

// RegisterStatus serves the last run to the app. The sync itself is a
// separate Lambda the app invokes directly.
func RegisterStatus(r *router.Router, repo StatusRepository) {
	r.Register("sync.status", func(ctx context.Context, _ json.RawMessage) (any, error) {
		return repo.Get(ctx)
	})
}

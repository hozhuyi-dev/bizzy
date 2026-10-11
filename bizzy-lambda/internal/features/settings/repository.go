package settings

import (
	"context"

	"bizzy-lambda/internal/platform/dynamo"
)

const (
	partition = "SETTINGS"
	sortKey   = "BUSINESS"
)

type record struct {
	dynamo.Keys
	Settings
}

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

// Get returns the settings with defaults filled in, even before she has
// saved any.
func (r Repository) Get(ctx context.Context) (Settings, error) {
	var rec record
	if _, err := r.store.Get(ctx, partition, sortKey, &rec); err != nil {
		return Settings{}, err
	}
	return rec.Settings.WithDefaults(), nil
}

func (r Repository) Put(ctx context.Context, s Settings) error {
	return r.store.Put(ctx, record{Keys: dynamo.Keys{PK: partition, SK: sortKey}, Settings: s})
}

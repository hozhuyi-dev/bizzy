package settings

import (
	"context"

	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/schema"
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
	keys := schema.SettingsKeys()
	if _, err := r.store.Get(ctx, keys.PK, keys.SK, &rec); err != nil {
		return Settings{}, err
	}
	return rec.Settings.WithDefaults(), nil
}

func (r Repository) Put(ctx context.Context, s Settings) error {
	return r.store.Put(ctx, record{Keys: schema.SettingsKeys(), Settings: s})
}

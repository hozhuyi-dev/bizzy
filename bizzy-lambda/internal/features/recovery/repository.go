package recovery

import (
	"context"

	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/schema"
)

type record struct {
	dynamo.Keys
	Entry
}

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

func (r Repository) Put(ctx context.Context, e Entry) error {
	return r.store.Put(ctx, record{Keys: schema.JournalKeys(e.ID), Entry: e})
}

func (r Repository) Delete(ctx context.Context, id string) error {
	keys := schema.JournalKeys(id)
	_, err := r.store.Delete(ctx, keys.PK, keys.SK, nil)
	return err
}

func (r Repository) List(ctx context.Context) ([]Entry, error) {
	records, err := dynamo.QueryAll[record](ctx, r.store, dynamo.Query{PK: schema.Journal})
	if err != nil {
		return nil, err
	}
	out := make([]Entry, len(records))
	for i, rec := range records {
		out[i] = rec.Entry
	}
	return out, nil
}

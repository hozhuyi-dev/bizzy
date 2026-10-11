package contacts

import (
	"context"

	"bizzy-lambda/internal/platform/dynamo"
)

const (
	partition    = "CONTACTS"
	dismissedKey = "DISMISSED"
)

type dismissedRecord struct {
	dynamo.Keys
	// Contacts maps a dismissed contact's resource name to its display name,
	// which is kept so Settings can list them.
	Contacts map[string]string `dynamodbav:"contacts"`
}

// DismissedRepository keeps the contacts she said are not clients, in one
// item: she only ever dismisses a handful.
type DismissedRepository struct {
	store *dynamo.Store
}

func NewDismissedRepository(store *dynamo.Store) DismissedRepository {
	return DismissedRepository{store: store}
}

func (r DismissedRepository) List(ctx context.Context) (map[string]string, error) {
	var rec dismissedRecord
	if _, err := r.store.Get(ctx, partition, dismissedKey, &rec); err != nil {
		return nil, err
	}
	if rec.Contacts == nil {
		rec.Contacts = map[string]string{}
	}
	return rec.Contacts, nil
}

func (r DismissedRepository) Set(ctx context.Context, resourceName, displayName string, dismissed bool) error {
	all, err := r.List(ctx)
	if err != nil {
		return err
	}
	if dismissed {
		all[resourceName] = displayName
	} else {
		delete(all, resourceName)
	}
	return r.store.Put(ctx, dismissedRecord{Keys: dynamo.Keys{PK: partition, SK: dismissedKey}, Contacts: all})
}

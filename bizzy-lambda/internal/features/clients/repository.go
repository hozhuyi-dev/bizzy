package clients

import (
	"context"
	"time"

	"bizzy-lambda/internal/platform/dynamo"
)

const partition = "CLIENT"

// Attributes each writer owns. A profile save from the app must not wipe the
// activity the reconcile computed, and the other way round.
var (
	profileAttributes  = []string{"id", "name", "email", "phone", "address", "postcode", "aliases", "defaultFeeCents", "homeVisits"}
	activityAttributes = []string{"activity", "lastSessionAt"}
)

type record struct {
	dynamo.Keys
	Client
}

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

func (r Repository) List(ctx context.Context) ([]Client, error) {
	records, err := dynamo.QueryAll[record](ctx, r.store, dynamo.Query{PK: partition})
	if err != nil {
		return nil, err
	}
	all := make([]Client, len(records))
	for i, rec := range records {
		all[i] = rec.Client
	}
	return all, nil
}

func (r Repository) Get(ctx context.Context, id string) (Client, bool, error) {
	var rec record
	found, err := r.store.Get(ctx, partition, id, &rec)
	return rec.Client, found, err
}

// SaveProfile writes the fields she edits in the app.
func (r Repository) SaveProfile(ctx context.Context, client Client) error {
	return r.patch(ctx, client, profileAttributes)
}

// SaveActivity writes the fields the billing reconcile derives.
func (r Repository) SaveActivity(ctx context.Context, client Client) error {
	return r.patch(ctx, client, activityAttributes)
}

func (r Repository) SetNextBooked(ctx context.Context, id string, at *time.Time) error {
	return r.patch(ctx, Client{ID: id, NextBookedAt: at}, []string{"nextBookedAt"})
}

func (r Repository) SetContacted(ctx context.Context, id string, at *time.Time) error {
	return r.patch(ctx, Client{ID: id, LastContactedAt: at}, []string{"lastContactedAt"})
}

func (r Repository) patch(ctx context.Context, client Client, owned []string) error {
	p, err := dynamo.OwnedFrom(partition, client.ID, client, owned)
	if err != nil {
		return err
	}
	_, err = r.store.Apply(ctx, p)
	return err
}

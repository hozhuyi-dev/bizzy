package clients

import (
	"context"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/schema"
)

// Keys: see schema.ClientKeys.
const partition = schema.Client

// Attributes each writer owns. A profile save from the app must not wipe the
// activity the reconcile computed, and the other way round.
var (
	profileAttributes  = []string{"id", "name", "contact", "aliases", "defaultFeeCents", "homeVisits"}
	activityAttributes = []string{"activity", "lastSessionAt", "nextBookedAt"}
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

// RefreshContact replaces the contact copy, but only while the client is
// still linked to the same contact at the version the caller read: a link or
// an edit made in the meantime wins. It reports whether it wrote.
func (r Repository) RefreshContact(ctx context.Context, id string, previous, next Contact) (bool, error) {
	p, err := dynamo.OwnedFrom(partition, id, Client{ID: id, Contact: &next}, []string{"contact"})
	if err != nil {
		return false, err
	}
	p.When = &dynamo.Condition{
		Expression: "#c.#rn = :rn AND #c.#etag = :etag",
		Names:      map[string]string{"#c": "contact", "#rn": "resourceName", "#etag": "etag"},
		Values:     map[string]types.AttributeValue{":rn": dynamo.S(previous.ResourceName), ":etag": dynamo.S(previous.ETag)},
	}
	return r.store.Apply(ctx, p)
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

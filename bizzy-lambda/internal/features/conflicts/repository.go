package conflicts

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/schema"
)

// Keys: see schema.ConflictKeys and schema.ExternalKeys.

type record struct {
	dynamo.Keys
	Conflict
}

func toRecord(c Conflict) record {
	return record{Keys: schema.ConflictKeys(c.Key, c.At, c.ClientID, c.TargetID), Conflict: c}
}

type externalRecord struct {
	dynamo.Keys
	External
}

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

func (r Repository) Get(ctx context.Context, key string) (Conflict, bool, error) {
	var rec record
	found, err := r.store.Get(ctx, schema.Conflict, key, &rec)
	return rec.Conflict, found, err
}

// ListOpen returns every conflict, oldest first.
func (r Repository) ListOpen(ctx context.Context) ([]Conflict, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexOpen})
}

// ListByTarget returns the conflicts over what one entity shows.
func (r Repository) ListByTarget(ctx context.Context, targetID string) ([]Conflict, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexRelation, Prefix: targetID + "#"})
}

func (r Repository) query(ctx context.Context, q dynamo.Query) ([]Conflict, error) {
	q.PK = schema.Conflict
	records, err := dynamo.QueryAll[record](ctx, r.store, q)
	if err != nil {
		return nil, err
	}
	out := make([]Conflict, len(records))
	for i, rec := range records {
		out[i] = rec.Conflict
	}
	return out, nil
}

// Save writes a conflict if it is still at the version read (0 for a new
// one); dynamo.ErrConflict otherwise.
func (r Repository) Save(ctx context.Context, c Conflict) (Conflict, error) {
	previous := c.Version
	c.Version++
	if err := r.store.PutVersioned(ctx, toRecord(c), previous); err != nil {
		return Conflict{}, err
	}
	return c, nil
}

func (r Repository) Delete(ctx context.Context, key string) error {
	_, err := r.store.Delete(ctx, schema.Conflict, key, nil)
	return err
}

// External returns what a record on a surface shows.
func (r Repository) External(ctx context.Context, surface Surface, externalID string) (External, bool, error) {
	var rec externalRecord
	found, err := r.store.Get(ctx, schema.External, Key(surface, externalID), &rec)
	return rec.External, found, err
}

func (r Repository) PutExternal(ctx context.Context, e External) error {
	return r.store.Put(ctx, externalRecord{Keys: schema.ExternalKeys(string(e.Surface), e.ExternalID), External: e})
}

func (r Repository) DeleteExternal(ctx context.Context, surface Surface, externalID string) error {
	_, err := r.store.Delete(ctx, schema.External, Key(surface, externalID), nil)
	return err
}

// ExternalPutItem stores what a record shows, in a transaction: only if it
// shows nothing else yet, so one record never shows two things.
func ExternalPutItem(e External) dynamo.TransactItem {
	cond := &dynamo.Condition{
		Expression: "attribute_not_exists(PK) OR #id = :id",
		Names:      map[string]string{"#id": "id"},
		Values:     map[string]types.AttributeValue{":id": dynamo.S(e.ID)},
	}
	return dynamo.TransactItem{Put: externalRecord{Keys: schema.ExternalKeys(string(e.Surface), e.ExternalID), External: e}, When: cond}
}

// ExternalDeleteItem forgets what a record showed, in a transaction.
func ExternalDeleteItem(surface Surface, externalID string) dynamo.TransactItem {
	return dynamo.TransactItem{Delete: &[2]string{schema.External, Key(surface, externalID)}}
}

// DeleteItem drops a conflict, in a transaction.
func DeleteItem(key string) dynamo.TransactItem {
	return dynamo.TransactItem{Delete: &[2]string{schema.Conflict, key}}
}

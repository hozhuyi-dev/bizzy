package attachments

import (
	"cmp"
	"context"
	"slices"

	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/schema"
)

// Keys: see schema.AttachmentKeys.

type record struct {
	dynamo.Keys
	Attachment
}

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

func (r Repository) List(ctx context.Context, kind OwnerKind, ownerID string) ([]Attachment, error) {
	records, err := dynamo.QueryAll[record](ctx, r.store, dynamo.Query{PK: schema.Attachment, Prefix: schema.AttachmentPrefix(string(kind), ownerID)})
	if err != nil {
		return nil, err
	}
	out := make([]Attachment, len(records))
	for i, rec := range records {
		out[i] = rec.Attachment
	}
	SortOldestFirst(out)
	return out, nil
}

func (r Repository) Get(ctx context.Context, kind OwnerKind, ownerID, id string) (Attachment, bool, error) {
	var rec record
	keys := schema.AttachmentKeys(string(kind), ownerID, id)
	found, err := r.store.Get(ctx, keys.PK, keys.SK, &rec)
	return rec.Attachment, found, err
}

func (r Repository) Put(ctx context.Context, a Attachment) error {
	return r.store.Put(ctx, record{Keys: schema.AttachmentKeys(string(a.OwnerKind), a.OwnerID, a.ID), Attachment: a})
}

func (r Repository) Delete(ctx context.Context, a Attachment) error {
	keys := schema.AttachmentKeys(string(a.OwnerKind), a.OwnerID, a.ID)
	_, err := r.store.Delete(ctx, keys.PK, keys.SK, nil)
	return err
}

// SortOldestFirst orders an owner's files as they were attached; ids are
// random, so the key order isn't it.
func SortOldestFirst(all []Attachment) {
	slices.SortFunc(all, func(a, b Attachment) int {
		return cmp.Or(a.UploadedAt.Compare(b.UploadedAt), cmp.Compare(a.ID, b.ID))
	})
}

// ListAll returns every attachment, by owner.
func (r Repository) ListAll(ctx context.Context) ([]Attachment, error) {
	records, err := dynamo.QueryAll[record](ctx, r.store, dynamo.Query{PK: schema.Attachment})
	if err != nil {
		return nil, err
	}
	out := make([]Attachment, len(records))
	for i, rec := range records {
		out[i] = rec.Attachment
	}
	return out, nil
}

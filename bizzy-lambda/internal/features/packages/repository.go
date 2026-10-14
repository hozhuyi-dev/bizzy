package packages

import (
	"context"

	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/schema"
)

// Keys: see schema.PackageKeys.
const Partition = schema.Package

type record struct {
	dynamo.Keys
	Package
}

func toRecord(p Package) record {
	return record{Keys: schema.PackageKeys(p.ID, p.PurchasedAt, p.ClientID, p.Open()), Package: p}
}

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

func (r Repository) Get(ctx context.Context, id string) (Package, bool, error) {
	var rec record
	found, err := r.store.Get(ctx, Partition, id, &rec)
	return rec.Package, found, err
}

// List returns every package, newest first.
func (r Repository) List(ctx context.Context) ([]Package, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexTime, Descending: true})
}

// ListOpen returns packages with credits left or still to be paid, oldest
// first.
func (r Repository) ListOpen(ctx context.Context) ([]Package, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexOpen})
}

func (r Repository) ListByClient(ctx context.Context, clientID string) ([]Package, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexClient, Prefix: clientID + "#"})
}

func (r Repository) query(ctx context.Context, q dynamo.Query) ([]Package, error) {
	q.PK = Partition
	records, err := dynamo.QueryAll[record](ctx, r.store, q)
	if err != nil {
		return nil, err
	}
	all := make([]Package, len(records))
	for i, rec := range records {
		all[i] = rec.Package
	}
	return all, nil
}

// PutItem is the write that stores a package if it is still at the version
// read (0 for a new one), and the package at its new version.
func PutItem(p Package) (Package, dynamo.TransactItem) {
	previous := p.Version
	p.Version++
	return p, dynamo.TransactItem{Put: toRecord(p), When: dynamo.VersionIs(previous)}
}

// DeleteItem is the write that deletes a package at the version read.
func DeleteItem(p Package) dynamo.TransactItem {
	return dynamo.TransactItem{Delete: &[2]string{Partition, p.ID}, When: dynamo.VersionIs(p.Version)}
}

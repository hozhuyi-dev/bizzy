package payments

import (
	"context"
	"errors"

	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/dynamo"
)

// Repository commits payments to DynamoDB in one transaction.
type Repository struct {
	store    *dynamo.Store
	sessions sessions.Repository
	packages packages.Repository
}

func NewRepository(store *dynamo.Store, s sessions.Repository, p packages.Repository) Repository {
	return Repository{store: store, sessions: s, packages: p}
}

func (r Repository) GetSession(ctx context.Context, eventID string) (sessions.Session, bool, error) {
	return r.sessions.Get(ctx, eventID)
}

func (r Repository) GetPackage(ctx context.Context, id string) (packages.Package, bool, error) {
	return r.packages.Get(ctx, id)
}

func (r Repository) Commit(ctx context.Context, ss []sessions.Session, ps []packages.Package) error {
	var items []dynamo.TransactItem
	for _, s := range ss {
		_, item := sessions.PutItem(s)
		items = append(items, item)
	}
	for _, p := range ps {
		patch, err := packages.PaymentPatch(p)
		if err != nil {
			return err
		}
		items = append(items, dynamo.TransactItem{Patch: &patch})
	}
	err := r.store.Transact(ctx, items)
	if errors.Is(err, dynamo.ErrTransactionConflict) {
		return dynamo.ErrConflict
	}
	return err
}

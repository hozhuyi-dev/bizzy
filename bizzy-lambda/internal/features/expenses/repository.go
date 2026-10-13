package expenses

import (
	"cmp"
	"context"
	"slices"
	"strings"

	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/schema"
)

// Keys: see schema.ExpenseKeys, schema.ExpenseItemKeys and
// schema.ExpenseCategoriesKeys.

type record struct {
	dynamo.Keys
	Expense
}

type itemRecord struct {
	dynamo.Keys
	Item
}

type categoriesRecord struct {
	dynamo.Keys
	Categories []Category `dynamodbav:"categories"`
}

// Attributes each writer of an item owns: she edits the item, saving an
// expense remembers what it last cost.
var (
	itemAttributes       = []string{"id", "name", "categoryId", "archived"}
	lastAmountAttributes = []string{"lastAmountCents"}
)

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

// List returns the expenses dated in [from, to] (YYYY-MM-DD), oldest first.
func (r Repository) List(ctx context.Context, from, to string) ([]Expense, error) {
	records, err := dynamo.QueryAll[record](ctx, r.store, dynamo.Query{
		PK: schema.Expense, Index: dynamo.IndexTime, From: from, To: to + "#~",
	})
	if err != nil {
		return nil, err
	}
	out := make([]Expense, len(records))
	for i, rec := range records {
		out[i] = rec.Expense
	}
	return out, nil
}

func (r Repository) Get(ctx context.Context, id string) (Expense, bool, error) {
	var rec record
	found, err := r.store.Get(ctx, schema.Expense, id, &rec)
	return rec.Expense, found, err
}

// Save writes the whole expense if it is still at the version read (0 for
// a new one), and returns it at its new version. dynamo.ErrConflict means
// it changed meanwhile.
func (r Repository) Save(ctx context.Context, e Expense) (Expense, error) {
	previous := e.Version
	e.Version++
	rec := record{Keys: schema.ExpenseKeys(e.ID, e.Date, e.CreatedAt), Expense: e}
	if err := r.store.PutVersioned(ctx, rec, previous); err != nil {
		return Expense{}, err
	}
	return e, nil
}

// Delete removes an expense if it is still at the version read.
func (r Repository) Delete(ctx context.Context, e Expense) error {
	deleted, err := r.store.Delete(ctx, schema.Expense, e.ID, dynamo.VersionIs(e.Version))
	if err == nil && !deleted {
		return dynamo.ErrConflict
	}
	return err
}

func (r Repository) Items(ctx context.Context) ([]Item, error) {
	records, err := dynamo.QueryAll[itemRecord](ctx, r.store, dynamo.Query{PK: schema.ExpenseItem})
	if err != nil {
		return nil, err
	}
	out := make([]Item, len(records))
	for i, rec := range records {
		out[i] = rec.Item
	}
	SortItems(out)
	return out, nil
}

// SaveItem writes what she edits of an item, creating it if new.
func (r Repository) SaveItem(ctx context.Context, it Item) error {
	return r.patchItem(ctx, it, itemAttributes)
}

// SetLastAmount remembers what an item last cost.
func (r Repository) SetLastAmount(ctx context.Context, id string, cents int64) error {
	return r.patchItem(ctx, Item{ID: id, LastAmountCents: &cents}, lastAmountAttributes)
}

func (r Repository) patchItem(ctx context.Context, it Item, owned []string) error {
	p, err := dynamo.OwnedFrom(schema.ExpenseItem, it.ID, it, owned)
	if err != nil {
		return err
	}
	_, err = r.store.Apply(ctx, p)
	return err
}

// Categories returns her categories, or the defaults before she has saved
// any.
func (r Repository) Categories(ctx context.Context) ([]Category, error) {
	var rec categoriesRecord
	keys := schema.ExpenseCategoriesKeys()
	found, err := r.store.Get(ctx, keys.PK, keys.SK, &rec)
	if err != nil || !found {
		return slices.Clone(DefaultCategories), err
	}
	return rec.Categories, nil
}

func (r Repository) SaveCategories(ctx context.Context, all []Category) error {
	return r.store.Put(ctx, categoriesRecord{Keys: schema.ExpenseCategoriesKeys(), Categories: all})
}

// SortItems orders items by name, as she picks from them.
func SortItems(all []Item) {
	slices.SortFunc(all, func(a, b Item) int {
		return cmp.Or(strings.Compare(normalizeName(a.Name), normalizeName(b.Name)), cmp.Compare(a.ID, b.ID))
	})
}

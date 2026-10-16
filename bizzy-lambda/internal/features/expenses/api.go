package expenses

import (
	"context"
	"time"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// View is an expense as the app shows it.
type View struct {
	ID         string    `json:"id"`
	Date       string    `json:"date"`
	Vendor     string    `json:"vendor,omitempty"`
	Lines      []Line    `json:"lines"`
	Notes      string    `json:"notes,omitempty"`
	TotalCents int64     `json:"totalCents"`
	Files      int       `json:"files"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

func viewOf(tx *txn.Tx, e *Expense) (View, error) {
	files, err := attachments.Count(tx, attachments.OwnerExpense, e.ID)
	return View{
		ID: e.ID, Date: e.Date, Vendor: e.Vendor, Lines: e.Lines, Notes: e.Notes,
		TotalCents: e.TotalCents(), Files: files, CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt,
	}, err
}

// CatalogueView is what lines are picked from.
type CatalogueView struct {
	Categories []Category `json:"categories"`
	Items      []Item     `json:"items"`
}

type listRequest struct {
	// From and To are days, YYYY-MM-DD, both included.
	From string `json:"from"`
	To   string `json:"to"`
}

type idRequest struct {
	ID string `json:"id"`
}

type updateRequest struct {
	ID string `json:"id"`
	Receipt
}

type categoriesRequest struct {
	Categories []Category `json:"categories"`
}

// Routes registers the expenses' actions; blobs holds their files.
func Routes(r *router.Router, run *txn.Runner, blobs blobstore.Store) {
	one := func(ctx context.Context, do func(tx *txn.Tx) (*Expense, error)) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) {
			e, err := do(tx)
			if err != nil {
				return nil, err
			}
			return viewOf(tx, e)
		})
	}
	r.Query("expenses.list", router.Typed(func(ctx context.Context, in listRequest) (any, error) {
		from, errFrom := time.Parse(time.DateOnly, in.From)
		to, errTo := time.Parse(time.DateOnly, in.To)
		switch {
		case errFrom != nil || errTo != nil || to.Before(from):
			return nil, apperr.Invalid("From and to are days, from first.")
		case to.Sub(from) > 400*24*time.Hour:
			return nil, apperr.Invalid("Ask for at most a year at a time.")
		}
		return txn.Read(ctx, run, func(tx *txn.Tx) ([]View, error) {
			all, err := Expenses.Between(tx, from, to)
			out := []View{}
			for _, e := range all {
				v, err := viewOf(tx, e)
				if err != nil {
					return nil, err
				}
				out = append(out, v)
			}
			return out, err
		})
	}))
	r.Query("expenses.get", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (View, error) {
			e, err := Expenses.Get(tx, in.ID)
			if err != nil {
				return View{}, err
			}
			return viewOf(tx, e)
		})
	}))
	r.Query("expenses.catalogue", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (CatalogueView, error) {
			cats, err := CategoriesOf(tx)
			if err != nil {
				return CatalogueView{}, err
			}
			items, err := Items.All(tx)
			out := CatalogueView{Categories: cats, Items: []Item{}}
			for _, it := range items {
				out.Items = append(out.Items, *it)
			}
			return out, err
		})
	}))
	r.Mutation("expenses.create", router.Typed(func(ctx context.Context, in Receipt) (any, error) {
		return one(ctx, func(tx *txn.Tx) (*Expense, error) { return Create(tx, in) })
	}))
	r.Mutation("expenses.update", router.Typed(func(ctx context.Context, in updateRequest) (any, error) {
		return one(ctx, func(tx *txn.Tx) (*Expense, error) { return Update(tx, in.ID, in.Receipt) })
	}))
	r.Mutation("expenses.delete", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		keys, err := txn.Run(ctx, run, func(tx *txn.Tx) ([]string, error) { return Delete(tx, in.ID) })
		if err != nil {
			return nil, err
		}
		attachments.DeleteFiles(ctx, blobs, keys...)
		return nil, nil
	}))
	r.Mutation("expenses.saveItem", router.Typed(func(ctx context.Context, in Item) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (Item, error) {
			it, err := SaveItem(tx, in)
			if err != nil {
				return Item{}, err
			}
			return *it, nil
		})
	}))
	r.Mutation("expenses.saveCategories", router.Typed(func(ctx context.Context, in categoriesRequest) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) ([]Category, error) { return SaveCategories(tx, in.Categories) })
	}))
}

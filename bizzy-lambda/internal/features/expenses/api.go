package expenses

import (
	"cmp"
	"context"
	"slices"
	"time"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/listing"
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
	return viewWith(e, files), err
}

// viewWith is an expense's view, its files counted already (a list's, at once).
func viewWith(e *Expense, files int) View {
	return View{
		ID: e.ID, Date: e.Date, Vendor: e.Vendor, Lines: e.Lines, Notes: e.Notes,
		TotalCents: e.TotalCents(), Files: files, CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt,
	}
}

// SearchView is a page of expenses found and, on the first page, what all
// of them add up to.
type SearchView struct {
	listing.Page[View]
	Totals *Totals `json:"totals,omitempty"`
}

// Totals are what the expenses found add up to: only their lines in the
// categories and of the items searched for, when it was by those.
type Totals struct {
	Count      int   `json:"count"`
	SpentCents int64 `json:"spentCents"`
}

// CatalogueView is what the form suggests: the categories and items lines
// are picked from, and the vendors, last used first.
type CatalogueView struct {
	Categories []Category `json:"categories"`
	Items      []Item     `json:"items"`
	Vendors    []Vendor   `json:"vendors"`
}

// searchRequest finds expenses by words in the vendor, the notes or the
// items, and by days, categories (any of its lines in one), shops and
// items (by name, however typed) and whether its receipt is kept; an
// empty filter takes every value.
type searchRequest struct {
	listing.Request
	CategoryIDs []string `json:"categoryIds"`
	Vendors     []string `json:"vendors"`
	Items       []string `json:"items"`
	// Receipts are ReceiptKept, ReceiptMissing or both.
	Receipts []string `json:"receipts"`
}

// Whether an expense's receipt is kept: a file attached to it, for the
// tax return.
const (
	ReceiptKept    = "kept"
	ReceiptMissing = "missing"
)

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
	// expenses.search finds expenses, latest first, a page at a time.
	r.Query("expenses.search", router.Typed(func(ctx context.Context, in searchRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (SearchView, error) {
			// Expense dates are days, filed as UTC.
			from, to, err := in.Span(time.UTC)
			if err != nil {
				return SearchView{}, err
			}
			l := txn.List{From: from, To: to, Latest: true}
			words := in.Words()
			vendors, items := normalizeNames(in.Vendors), normalizeNames(in.Items)
			// Every expense's files in one read, not one read a row.
			files, err := attachments.Counts(tx, attachments.OwnerExpense)
			if err != nil {
				return SearchView{}, err
			}
			found := func(e *Expense) bool {
				fields := []string{e.Vendor, e.Notes}
				inCategory, ofItem := false, false
				for _, line := range e.Lines {
					fields = append(fields, line.Name)
					inCategory = inCategory || listing.OneOf(in.CategoryIDs, line.CategoryID)
					ofItem = ofItem || listing.OneOf(items, normalizeName(line.Name))
				}
				receipt := ReceiptMissing
				if files[e.ID] > 0 {
					receipt = ReceiptKept
				}
				return inCategory && ofItem && listing.OneOf(vendors, normalizeName(e.Vendor)) && listing.OneOf(in.Receipts, receipt) &&
					words.In(fields...)
			}
			var out SearchView
			if in.After == "" {
				out.Totals = &Totals{}
				_, err := Expenses.Each(tx, l, "", func(e *Expense) (bool, error) {
					if found(e) {
						out.Totals.Count++
						for _, line := range e.Lines {
							if listing.OneOf(in.CategoryIDs, line.CategoryID) && listing.OneOf(items, normalizeName(line.Name)) {
								out.Totals.SpentCents += line.AmountCents
							}
						}
					}
					return true, nil
				})
				if err != nil {
					return SearchView{}, err
				}
			}
			out.Page, err = listing.Read(tx, Expenses, l, in.Request, func(e *Expense) (View, bool, error) {
				return viewWith(e, files[e.ID]), found(e), nil
			})
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
			if err != nil {
				return CatalogueView{}, err
			}
			vendors, err := Vendors.All(tx)
			out := CatalogueView{Categories: cats, Items: []Item{}, Vendors: []Vendor{}}
			for _, it := range items {
				out.Items = append(out.Items, *it)
			}
			for _, v := range vendors {
				out.Vendors = append(out.Vendors, *v)
			}
			slices.SortFunc(out.Vendors, func(a, b Vendor) int {
				return cmp.Or(cmp.Compare(b.LastUsed, a.LastUsed), cmp.Compare(a.Name, b.Name))
			})
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
	r.Mutation("expenses.saveVendor", router.Typed(func(ctx context.Context, in Vendor) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (Vendor, error) {
			v, err := SaveVendor(tx, in)
			if err != nil {
				return Vendor{}, err
			}
			return *v, nil
		})
	}))
	r.Mutation("expenses.saveCategories", router.Typed(func(ctx context.Context, in categoriesRequest) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) ([]Category, error) { return SaveCategories(tx, in.Categories) })
	}))
}

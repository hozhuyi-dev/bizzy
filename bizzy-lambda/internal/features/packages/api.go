package packages

import (
	"context"
	"time"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// DocumentRef names a document a package is on.
type DocumentRef struct {
	ID     string `json:"id"`
	Number string `json:"number,omitempty"`
}

// View is a package as the app shows it.
type View struct {
	ID          string    `json:"id"`
	ClientID    string    `json:"clientId"`
	Hours       int       `json:"hours"`
	PurchasedAt time.Time `json:"purchasedAt"`
	BoughtIn    string    `json:"boughtIn,omitempty"`
	Note        string    `json:"note,omitempty"`
	// CreditsUsed and CreditsLeft are in hours, by the half hour.
	CreditsUsed float64         `json:"creditsUsed"`
	CreditsLeft float64         `json:"creditsLeft"`
	PriceCents  int64           `json:"priceCents"`
	Invoice     *DocumentRef    `json:"invoice,omitempty"`
	Paid        *documents.Paid `json:"paid,omitempty"`
	OwedCents   int64           `json:"owedCents"`
	Todo        []Reason        `json:"todo"`
}

// ViewOf is a package as of now: what it costs and was paid, its credits,
// and what is left to do on it.
func ViewOf(tx *txn.Tx, p *Package, used Usage) (View, error) {
	src := documents.PackageSource(p.ID)
	n, err := used(tx, p.ID)
	if err != nil {
		return View{}, err
	}
	v := View{
		ID: p.ID, ClientID: p.ClientID, Hours: p.Hours, PurchasedAt: p.PurchasedAt, BoughtIn: p.BoughtIn, Note: p.Note,
		CreditsUsed: float64(n) / 60, CreditsLeft: float64(max(p.Hours*60-n, 0)) / 60, Todo: []Reason{},
	}
	inv, line, err := documents.Invoice(tx, src)
	if err != nil {
		return View{}, err
	}
	if line != nil {
		v.PriceCents, v.Invoice = line.AmountCents, &DocumentRef{ID: inv.ID, Number: inv.Number}
	}
	if v.Paid, err = documents.Received(tx, src); err != nil {
		return View{}, err
	}
	if v.Paid == nil {
		v.OwedCents = v.PriceCents
	}
	v.Todo = p.Todo(v.OwedCents, tx.Now())
	return v, nil
}

type listRequest struct {
	// All includes used-up, paid packages; by default only those still in
	// use, or owed, are listed.
	All bool `json:"all"`
}

type updateRequest struct {
	ID string `json:"id"`
	Fields
}

type idRequest struct {
	ID string `json:"id"`
}

// Routes registers the packages' actions. used counts the minutes of a
// package's credits that sessions use (see Usage).
func Routes(r *router.Router, run *txn.Runner, used Usage) {
	view := func(tx *txn.Tx, p *Package, err error) (any, error) {
		if err != nil {
			return nil, err
		}
		return ViewOf(tx, p, used)
	}
	r.Query("packages.list", router.Typed(func(ctx context.Context, in listRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) ([]View, error) {
			all, err := Packages.All(tx)
			out := []View{}
			for _, p := range all {
				v, err := ViewOf(tx, p, used)
				if err != nil {
					return nil, err
				}
				if in.All || v.CreditsLeft > 0 || v.OwedCents > 0 {
					out = append(out, v)
				}
			}
			return out, err
		})
	}))
	r.Mutation("packages.create", router.Typed(func(ctx context.Context, in Fields) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) {
			p, err := Create(tx, in, used)
			return view(tx, p, err)
		})
	}))
	r.Mutation("packages.update", router.Typed(func(ctx context.Context, in updateRequest) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) {
			p, err := Update(tx, in.ID, in.Fields, used)
			return view(tx, p, err)
		})
	}))
	r.Mutation("packages.delete", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) { return nil, Delete(tx, in.ID, used) })
	}))
	r.Mutation("packages.makeStandalone", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) {
			p, err := MakeStandalone(tx, in.ID)
			return view(tx, p, err)
		})
	}))
}

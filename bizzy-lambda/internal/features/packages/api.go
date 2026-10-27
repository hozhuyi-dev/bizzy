package packages

import (
	"context"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/platform/apperr"
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
	// SharedWith are the other clients whose sessions its credits may pay
	// for, and Uses how many hours of them each client's sessions use
	// (its own client's too): one with any can't be unshared.
	SharedWith []string `json:"sharedWith"`
	Uses       []Use    `json:"uses"`
	// Payer is who pays for it: billed by its invoice, or who would be.
	Payer string `json:"payer"`
	// CreditsUsed and CreditsLeft are in hours, by the half hour.
	CreditsUsed float64         `json:"creditsUsed"`
	CreditsLeft float64         `json:"creditsLeft"`
	PriceCents  int64           `json:"priceCents"`
	Invoice     *DocumentRef    `json:"invoice,omitempty"`
	Paid        *documents.Paid `json:"paid,omitempty"`
	OwedCents   int64           `json:"owedCents"`
	Todo        []Reason        `json:"todo"`
	// Can is what each action on it would say now; Locked what its update
	// can't change (see Locks).
	Can    Can          `json:"can"`
	Locked apperr.Locks `json:"locked"`
}

// Use is how many hours of a package's credits a client's sessions use.
type Use struct {
	ClientID string  `json:"clientId"`
	Hours    float64 `json:"hours"`
}

// Can is what each action on a package would say now.
type Can struct {
	Pay            apperr.Verdict `json:"pay"`
	UndoPayment    apperr.Verdict `json:"undoPayment"`
	AskToPay       apperr.Verdict `json:"askToPay"`
	SendRecords    apperr.Verdict `json:"sendRecords"`
	MakeStandalone apperr.Verdict `json:"makeStandalone"`
	Delete         apperr.Verdict `json:"delete"`
}

// Locks are what an update to a package can't change now.
func Locks(tx *txn.Tx, p *Package, used Usage) (apperr.Locks, error) {
	reassign := CanMoveBought(p)
	if reassign == nil {
		reassign = CanReassign(tx, p, used)
	}
	return apperr.LocksOf(map[string]error{
		"clientId":    reassign,
		"purchasedAt": CanMoveBought(p),
		"hours":       CanResize(tx, p),
		"priceCents":  CanReprice(tx, p),
		"billTo":      CanBillTo(tx, p),
		"payment":     CanChangePayment(tx, p),
	})
}

// ViewOf is a package as of now: what it costs and was paid, its credits,
// and what is left to do on it.
func ViewOf(tx *txn.Tx, p *Package, used Usage) (View, error) {
	src := documents.PackageSource(p.ID)
	u, err := used(tx, p.ID)
	if err != nil {
		return View{}, err
	}
	n := u.Minutes()
	v := View{
		ID: p.ID, ClientID: p.ClientID, Hours: p.Hours, PurchasedAt: p.PurchasedAt, BoughtIn: p.BoughtIn, Note: p.Note,
		SharedWith: append([]string{}, p.SharedWith...), Uses: []Use{},
		CreditsUsed: float64(n) / 60, CreditsLeft: float64(max(p.Hours*60-n, 0)) / 60, Todo: []Reason{},
	}
	for _, id := range p.Clients() {
		if u[id] > 0 {
			v.Uses = append(v.Uses, Use{ClientID: id, Hours: float64(u[id]) / 60})
		}
	}
	inv, line, err := documents.Invoice(tx, src)
	if err != nil {
		return View{}, err
	}
	if line != nil {
		v.PriceCents, v.Invoice = line.AmountCents, &DocumentRef{ID: inv.ID, Number: inv.Number}
		v.Payer = inv.ClientID
	} else if v.Payer, err = clients.PayerOf(tx, p.ClientID); err != nil {
		return View{}, err
	}
	if v.Paid, err = documents.Received(tx, src); err != nil {
		return View{}, err
	}
	if v.Paid == nil {
		v.OwedCents = v.PriceCents
	}
	v.Todo = p.Todo(v.OwedCents, tx.Now())
	// The credits used, counted above, rather than counted again.
	counted := func(*txn.Tx, string) (Used, error) { return u, nil }
	for _, c := range []struct {
		verdict *apperr.Verdict
		check   error
	}{
		{&v.Can.Pay, CanPay(tx, p)},
		{&v.Can.UndoPayment, CanUndoPayment(tx, p)},
		{&v.Can.AskToPay, documents.CanAskToPay(tx, []documents.Source{src}, nil)},
		{&v.Can.SendRecords, documents.CanSendRecords(tx, []documents.Source{src})},
		{&v.Can.MakeStandalone, CanMakeStandalone(p)},
		{&v.Can.Delete, CanDelete(tx, p, counted)},
	} {
		if *c.verdict, err = apperr.VerdictOf(c.check); err != nil {
			return View{}, err
		}
	}
	v.Locked, err = Locks(tx, p, counted)
	return v, err
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

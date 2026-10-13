package packages

import (
	"context"
	"strings"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
	"bizzy-lambda/internal/shared/money"
)

// HandlerStore is what the handlers read and write.
type HandlerStore interface {
	Get(ctx context.Context, id string) (Package, bool, error)
	List(ctx context.Context) ([]Package, error)
	ListOpen(ctx context.Context) ([]Package, error)
	Save(ctx context.Context, p Package) error
	SetPayment(ctx context.Context, p Package) error
	Delete(ctx context.Context, id string) (bool, error)
}

// AfterChange reallocates credits for the clients a package change touches.
type AfterChange func(ctx context.Context, clientIDs ...string) error

type handler struct {
	repo        HandlerStore
	afterChange AfterChange
	now         func() time.Time
	loc         *time.Location
}

func Register(r *router.Router, repo HandlerStore, afterChange AfterChange, loc *time.Location, now func() time.Time) {
	h := handler{repo: repo, afterChange: afterChange, now: now, loc: loc}
	r.Query("packages.list", router.Typed(h.list))
	r.Mutation("packages.save", router.Typed(h.save))
	r.Mutation("packages.delete", router.Typed(h.delete))
}

type listInput struct {
	// All includes used-up packages; by default only open ones are listed.
	All bool `json:"all"`
}

func (h handler) list(ctx context.Context, in listInput) (any, error) {
	list := h.repo.ListOpen
	if in.All {
		list = h.repo.List
	}
	all, err := list(ctx)
	return Views(all, h.now()), err
}

type saveInput struct {
	ID          string    `json:"id"`
	ClientID    string    `json:"clientId"`
	Sessions    int       `json:"sessions"`
	PriceCents  int64     `json:"priceCents"`
	PurchasedAt time.Time `json:"purchasedAt"`
	Note        string    `json:"note"`
	// Paid records it as paid in full when she adds it, if she was paid
	// there and then. Later, payments.set records it.
	Paid *money.Input `json:"paid"`
}

// save creates or edits a package bought outside the calendar. Calendar
// packages are edited in the calendar.
func (h handler) save(ctx context.Context, in saveInput) (any, error) {
	switch {
	case in.ClientID == "":
		return nil, apperr.Invalid("client is required")
	case in.Sessions < 1 || in.Sessions > 1000:
		return nil, apperr.Invalid("sessions must be between 1 and 1000")
	case in.PriceCents < 0:
		return nil, apperr.Invalid("price can't be negative")
	case in.PurchasedAt.IsZero():
		return nil, apperr.Invalid("purchase date is required")
	}

	p := Package{ID: in.ID, Source: SourceApp}
	previousClient := ""
	if in.ID != "" {
		existing, found, err := h.repo.Get(ctx, in.ID)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, apperr.NotFound("package not found")
		}
		if err := existing.CanEdit(); err != nil {
			return nil, err
		}
		p, previousClient = existing, existing.ClientID
	} else {
		p.ID = dynamo.NewID()
	}

	p.ClientID, p.Sessions, p.PriceCents = in.ClientID, in.Sessions, in.PriceCents
	p.PurchasedAt, p.Note = in.PurchasedAt.UTC(), strings.TrimSpace(in.Note)

	var payment *money.Payment
	if in.Paid != nil && p.Payment == nil {
		var err error
		if payment, err = money.New(*in.Paid, p.PriceCents, p.PriceCents, h.now(), h.loc); err != nil {
			return nil, err
		}
	}

	if err := h.repo.Save(ctx, p); err != nil {
		return nil, err
	}
	if payment != nil {
		p.Payment = payment
		if err := h.repo.SetPayment(ctx, p); err != nil {
			return nil, err
		}
	}
	if err := h.afterChange(ctx, p.ClientID, previousClient); err != nil {
		return nil, err
	}
	// The reconcile may have used its credits.
	if saved, found, err := h.repo.Get(ctx, p.ID); err != nil {
		return nil, err
	} else if found {
		p = saved
	}
	return p.View(h.now()), nil
}

type deleteInput struct {
	ID string `json:"id"`
}

func (h handler) delete(ctx context.Context, in deleteInput) (any, error) {
	existing, found, err := h.repo.Get(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, apperr.NotFound("package not found")
	}
	if err := existing.CanDelete(); err != nil {
		return nil, err
	}
	deleted, err := h.repo.Delete(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	if !deleted {
		return nil, apperr.Conflict("cancel the documents for this package first")
	}
	return nil, h.afterChange(ctx, existing.ClientID)
}

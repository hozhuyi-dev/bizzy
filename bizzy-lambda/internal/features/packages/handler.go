package packages

import (
	"context"
	"strings"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

type store interface {
	Get(ctx context.Context, id string) (Package, bool, error)
	List(ctx context.Context) ([]Package, error)
	ListOpen(ctx context.Context) ([]Package, error)
	Save(ctx context.Context, p Package) error
	Delete(ctx context.Context, id string) (bool, error)
}

// AfterChange reallocates credits for the clients a package change touches.
type AfterChange func(ctx context.Context, clientIDs ...string) error

type handler struct {
	repo        store
	afterChange AfterChange
}

func Register(r *router.Router, repo store, afterChange AfterChange) {
	h := handler{repo: repo, afterChange: afterChange}
	r.Register("packages.list", router.Typed(h.list))
	r.Register("packages.save", router.Typed(h.save))
	r.Register("packages.delete", router.Typed(h.delete))
}

type listInput struct {
	// All includes used-up packages; by default only open ones are listed.
	All bool `json:"all"`
}

func (h handler) list(ctx context.Context, in listInput) (any, error) {
	if in.All {
		return h.repo.List(ctx)
	}
	return h.repo.ListOpen(ctx)
}

type saveInput struct {
	ID          string    `json:"id"`
	ClientID    string    `json:"clientId"`
	Sessions    int       `json:"sessions"`
	PriceCents  int64     `json:"priceCents"`
	PurchasedAt time.Time `json:"purchasedAt"`
	Note        string    `json:"note"`
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
		if existing.Source != SourceApp {
			return nil, apperr.Conflict("this package comes from the calendar; change it there")
		}
		if existing.HasDocuments() {
			return nil, apperr.Conflict("cancel the documents for this package first")
		}
		p, previousClient = existing, existing.ClientID
	} else {
		p.ID = dynamo.NewID()
	}

	p.ClientID, p.Sessions, p.PriceCents = in.ClientID, in.Sessions, in.PriceCents
	p.PurchasedAt, p.Note = in.PurchasedAt.UTC(), strings.TrimSpace(in.Note)

	if err := h.repo.Save(ctx, p); err != nil {
		return nil, err
	}
	if err := h.afterChange(ctx, nonEmpty(p.ClientID, previousClient)...); err != nil {
		return nil, err
	}
	return p, nil
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
	if existing.Source != SourceApp {
		return nil, apperr.Conflict("this package comes from the calendar; remove it there")
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

func nonEmpty(values ...string) []string {
	var out []string
	for _, v := range values {
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

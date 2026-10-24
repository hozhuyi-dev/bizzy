package contacts

import (
	"context"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// View is a Google contact as the app shows it. Google's shape is the
// contract here: bizzy stores none of it but the client's copy.
type View = Person

type getRequest struct {
	ResourceName string `json:"resourceName"`
}

type updateRequest struct {
	ResourceName string  `json:"resourceName"`
	ETag         string  `json:"etag"`
	Details      Details `json:"details"`
}

// Routes registers the contacts' actions.
func Routes(r *router.Router, run *txn.Runner, dir Directory) {
	r.Query("contacts.list", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		return dir.List(ctx)
	}))
	r.Query("contacts.get", router.Typed(func(ctx context.Context, in getRequest) (any, error) {
		if in.ResourceName == "" {
			return nil, apperr.Invalid("resourceName is required")
		}
		return dir.Get(ctx, in.ResourceName)
	}))
	r.Mutation("contacts.create", router.Typed(func(ctx context.Context, in Details) (any, error) {
		d := in.trimmed()
		if err := checkDetails(d, true); err != nil {
			return nil, err
		}
		return dir.Create(ctx, d)
	}))
	// contacts.update writes the edit to Google, then copies it onto every
	// client linked to the contact, so lists and receipts show it at once.
	r.Mutation("contacts.update", router.Typed(func(ctx context.Context, in updateRequest) (any, error) {
		if in.ResourceName == "" || in.ETag == "" {
			return nil, apperr.Invalid("resourceName and etag are required")
		}
		p, err := dir.Update(ctx, in.ResourceName, in.ETag, in.Details.trimmed())
		if err != nil {
			return nil, err
		}
		_, err = txn.Run(ctx, run, func(tx *txn.Tx) (any, error) { return nil, Refresh(tx, []Person{p}) })
		return View(p), err
	}))
}

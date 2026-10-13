package attachments

import (
	"context"

	"bizzy-lambda/internal/router"
)

type ownerInput struct {
	OwnerKind OwnerKind `json:"ownerKind"`
	OwnerID   string    `json:"ownerId"`
}

type removeInput struct {
	OwnerKind OwnerKind `json:"ownerKind"`
	OwnerID   string    `json:"ownerId"`
	ID        string    `json:"id"`
}

// Register serves attachments to the app. Requesting an upload only signs a
// URL, so it is a query: nothing is stored until the upload is confirmed.
func Register(r *router.Router, s Service) {
	r.Query("attachments.list", router.Typed(func(ctx context.Context, in ownerInput) (any, error) {
		return s.List(ctx, in.OwnerKind, in.OwnerID)
	}))
	r.Query("attachments.requestUpload", router.Typed(func(ctx context.Context, in UploadInput) (any, error) {
		return s.RequestUpload(ctx, in)
	}))
	r.Mutation("attachments.confirm", router.Typed(func(ctx context.Context, in ConfirmInput) (any, error) {
		return s.Confirm(ctx, in)
	}))
	r.Mutation("attachments.delete", router.Typed(func(ctx context.Context, in removeInput) (any, error) {
		return nil, s.Remove(ctx, in.OwnerKind, in.OwnerID, in.ID)
	}))
}

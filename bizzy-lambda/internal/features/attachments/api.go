package attachments

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// View is an attachment with short-lived links to its file.
type View struct {
	ID          string    `json:"id"`
	OwnerKind   OwnerKind `json:"ownerKind"`
	OwnerID     string    `json:"ownerId"`
	Name        string    `json:"name"`
	ContentType string    `json:"contentType"`
	SizeBytes   int64     `json:"sizeBytes"`
	UploadedAt  time.Time `json:"uploadedAt"`
	// URL shows the file in the browser; DownloadURL saves it.
	URL         string `json:"url"`
	DownloadURL string `json:"downloadUrl"`
}

// Ticket is where to upload a file, and the id to confirm it under.
type Ticket struct {
	ID     string           `json:"id"`
	Upload blobstore.Upload `json:"upload"`
}

// Links are short-lived: long enough to look through a session's photos,
// short enough that a link pasted somewhere stops working.
const (
	uploadExpiry = 15 * time.Minute
	linkExpiry   = time.Hour
)

// ErrNotUploaded is a confirm for a file that never arrived.
var ErrNotUploaded = apperr.Conflict("The file didn't finish uploading. Try attaching it again.")

func viewOf(ctx context.Context, blobs blobstore.Store, a *Attachment) (View, error) {
	v := View{
		ID: a.ID, OwnerKind: a.OwnerKind, OwnerID: a.OwnerID, Name: a.Name,
		ContentType: a.ContentType, SizeBytes: a.SizeBytes, UploadedAt: a.UploadedAt,
	}
	var err error
	if v.URL, err = blobs.PresignGet(ctx, a.Key, a.Name, false, linkExpiry); err != nil {
		return v, err
	}
	v.DownloadURL, err = blobs.PresignGet(ctx, a.Key, a.Name, true, linkExpiry)
	return v, err
}

type ownerRequest struct {
	OwnerKind OwnerKind `json:"ownerKind"`
	OwnerID   string    `json:"ownerId"`
}

type uploadRequest struct {
	OwnerKind   OwnerKind `json:"ownerKind"`
	OwnerID     string    `json:"ownerId"`
	Name        string    `json:"name"`
	ContentType string    `json:"contentType"`
	SizeBytes   int64     `json:"sizeBytes"`
}

type confirmRequest struct {
	OwnerKind   OwnerKind `json:"ownerKind"`
	OwnerID     string    `json:"ownerId"`
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	ContentType string    `json:"contentType"`
}

type idRequest struct {
	ID string `json:"id"`
}

// Routes registers the attachments' actions. owners say, by kind, whether
// files can be attached to an item now (see Owner).
func Routes(r *router.Router, run *txn.Runner, blobs blobstore.Store, owners map[OwnerKind]Owner) {
	r.Query("attachments.list", router.Typed(func(ctx context.Context, in ownerRequest) (any, error) {
		all, err := txn.Read(ctx, run, func(tx *txn.Tx) ([]*Attachment, error) { return Of(tx, in.OwnerKind, in.OwnerID) })
		if err != nil {
			return nil, err
		}
		out := []View{}
		for _, a := range all {
			v, err := viewOf(ctx, blobs, a)
			if err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		return out, nil
	}))
	// attachments.requestUpload only signs a URL, so it is a query:
	// nothing is stored until the upload is confirmed.
	r.Query("attachments.requestUpload", router.Typed(func(ctx context.Context, in uploadRequest) (any, error) {
		owner, err := ownerOf(owners, in.OwnerKind)
		if err != nil {
			return nil, err
		}
		if err := checkFile(in.Name, in.ContentType, in.SizeBytes); err != nil {
			return nil, err
		}
		id, err := txn.Read(ctx, run, func(tx *txn.Tx) (string, error) { return tx.NewID(), owner(tx, in.OwnerID) })
		if err != nil {
			return nil, err
		}
		up, err := blobs.PresignPut(ctx, KeyOf(in.OwnerKind, in.OwnerID, id, in.ContentType), in.ContentType, in.SizeBytes, uploadExpiry)
		return Ticket{ID: id, Upload: up}, err
	}))
	r.Mutation("attachments.confirm", router.Typed(func(ctx context.Context, in confirmRequest) (any, error) {
		owner, err := ownerOf(owners, in.OwnerKind)
		if err != nil {
			return nil, err
		}
		if _, ok := Types[in.ContentType]; !ok || in.ID == "" {
			return nil, ErrNotUploaded
		}
		key := KeyOf(in.OwnerKind, in.OwnerID, in.ID, in.ContentType)
		got, err := blobs.Confirm(ctx, key)
		if errors.Is(err, blobstore.ErrMissing) {
			return nil, ErrNotUploaded
		}
		if err != nil {
			return nil, err
		}
		a, err := txn.Run(ctx, run, func(tx *txn.Tx) (*Attachment, error) {
			return Confirm(tx, owner, in.OwnerKind, in.OwnerID, in.ID, in.Name, got)
		})
		if err != nil {
			var shown *apperr.Error
			if errors.As(err, &shown) && shown.Code == apperr.CodeInvalid {
				// The signed upload pins the type and size, so this is a
				// file that was swapped: it isn't kept.
				_ = blobs.Delete(ctx, key)
			}
			return nil, err
		}
		return viewOf(ctx, blobs, a)
	}))
	r.Mutation("attachments.delete", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		key, err := txn.Run(ctx, run, func(tx *txn.Tx) (string, error) {
			a, err := Attachments.Get(tx, in.ID)
			if err != nil {
				return "", err
			}
			owner, err := ownerOf(owners, a.OwnerKind)
			if err != nil {
				return "", err
			}
			return Remove(tx, owner, in.ID)
		})
		if err != nil {
			return nil, err
		}
		DeleteFiles(ctx, blobs, key)
		return nil, nil
	}))
}

// DeleteFiles deletes files whose attachments a commit deleted. A failure
// is logged: the quarterly sweep deletes what is left.
func DeleteFiles(ctx context.Context, blobs blobstore.Store, keys ...string) {
	if len(keys) == 0 {
		return
	}
	if err := blobs.Delete(ctx, keys...); err != nil {
		slog.WarnContext(ctx, "delete attachment files", "keys", keys, "error", err)
	}
}

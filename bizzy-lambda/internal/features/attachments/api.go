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
	// OriginalBytes is a photo's size before it was shrunk; 0 for none.
	OriginalBytes int64     `json:"originalBytes,omitempty"`
	UploadedAt    time.Time `json:"uploadedAt"`
	// URL shows the file in the browser; DownloadURL saves it.
	URL         string `json:"url"`
	DownloadURL string `json:"downloadUrl"`
	// ThumbnailURL shows its thumbnail; "" for none.
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
}

// Ticket is where to upload a file and its thumbnail, and the id to
// confirm them under.
type Ticket struct {
	ID              string            `json:"id"`
	Upload          blobstore.Upload  `json:"upload"`
	ThumbnailUpload *blobstore.Upload `json:"thumbnailUpload,omitempty"`
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
		ContentType: a.ContentType, SizeBytes: a.SizeBytes, OriginalBytes: a.OriginalBytes, UploadedAt: a.UploadedAt,
	}
	var err error
	if v.URL, err = blobs.PresignGet(ctx, a.Key, a.Name, false, linkExpiry); err != nil {
		return v, err
	}
	if v.DownloadURL, err = blobs.PresignGet(ctx, a.Key, a.Name, true, linkExpiry); err != nil {
		return v, err
	}
	if a.ThumbnailKey != "" {
		v.ThumbnailURL, err = blobs.PresignGet(ctx, a.ThumbnailKey, a.Name, false, linkExpiry)
	}
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
	// ThumbnailBytes is its thumbnail's size; 0 for none.
	ThumbnailBytes int64 `json:"thumbnailBytes"`
}

type confirmRequest struct {
	OwnerKind   OwnerKind `json:"ownerKind"`
	OwnerID     string    `json:"ownerId"`
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	ContentType string    `json:"contentType"`
	// Thumbnail is whether its thumbnail was uploaded.
	Thumbnail     bool  `json:"thumbnail"`
	OriginalBytes int64 `json:"originalBytes"`
	// Replaces is an attachment beside it this one takes the place of.
	Replaces string `json:"replaces"`
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
		ticket := Ticket{ID: id}
		if ticket.Upload, err = blobs.PresignPut(ctx, KeyOf(in.OwnerKind, in.OwnerID, id, in.ContentType), in.ContentType, in.SizeBytes, uploadExpiry); err != nil {
			return nil, err
		}
		// A thumbnail too big is left out, not refused: the file is what matters.
		if in.ThumbnailBytes > 0 && in.ThumbnailBytes <= ThumbnailMaxBytes {
			up, err := blobs.PresignPut(ctx, ThumbnailKeyOf(in.OwnerKind, in.OwnerID, id), ThumbnailType, in.ThumbnailBytes, uploadExpiry)
			if err != nil {
				return nil, err
			}
			ticket.ThumbnailUpload = &up
		}
		return ticket, nil
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
		arrival := Arrival{
			Kind: in.OwnerKind, OwnerID: in.OwnerID, ID: in.ID, Name: in.Name, File: got,
			Thumbnail:     in.Thumbnail && confirmThumbnail(ctx, blobs, ThumbnailKeyOf(in.OwnerKind, in.OwnerID, in.ID)),
			OriginalBytes: in.OriginalBytes, Replaces: in.Replaces,
		}
		var replaced []string
		a, err := txn.Run(ctx, run, func(tx *txn.Tx) (a *Attachment, err error) {
			a, replaced, err = Confirm(tx, owner, arrival)
			return a, err
		})
		if err != nil {
			var shown *apperr.Error
			if errors.As(err, &shown) && shown.Code == apperr.CodeInvalid {
				// The signed upload pins the type and size, so this is a
				// file that was swapped: it isn't kept.
				_ = blobs.Delete(ctx, key, ThumbnailKeyOf(in.OwnerKind, in.OwnerID, in.ID))
			}
			return nil, err
		}
		DeleteFiles(ctx, blobs, replaced...)
		return viewOf(ctx, blobs, a)
	}))
	r.Mutation("attachments.delete", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		keys, err := txn.Run(ctx, run, func(tx *txn.Tx) ([]string, error) {
			a, err := Attachments.Get(tx, in.ID)
			if err != nil {
				return nil, err
			}
			owner, err := ownerOf(owners, a.OwnerKind)
			if err != nil {
				return nil, err
			}
			return Remove(tx, owner, in.ID)
		})
		if err != nil {
			return nil, err
		}
		DeleteFiles(ctx, blobs, keys...)
		return nil, nil
	}))
}

// confirmThumbnail keeps a thumbnail that arrived as one should be: one
// that didn't arrive is no thumbnail, and one that isn't is deleted. Its
// failing never fails the file's confirm.
func confirmThumbnail(ctx context.Context, blobs blobstore.Store, key string) bool {
	got, err := blobs.Confirm(ctx, key)
	switch {
	case errors.Is(err, blobstore.ErrMissing):
		return false
	case err != nil:
		slog.WarnContext(ctx, "confirm attachment thumbnail", "key", key, "error", err)
		return false
	case got.ContentType != ThumbnailType || got.Size <= 0 || got.Size > ThumbnailMaxBytes:
		DeleteFiles(ctx, blobs, key)
		return false
	}
	return true
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

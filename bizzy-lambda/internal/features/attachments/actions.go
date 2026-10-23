package attachments

import (
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/txn"
)

// Arrival is a file the browser uploaded, as blob storage says it arrived.
type Arrival struct {
	Kind    OwnerKind
	OwnerID string
	ID      string
	Name    string
	File    blobstore.Object
	// Thumbnail is whether its thumbnail arrived as one should be.
	Thumbnail bool
	// OriginalBytes is a photo's size before the browser shrank it; 0 for
	// a file uploaded as it was.
	OriginalBytes int64
	// Replaces is the id of the owner's attachment this one takes the
	// place of (a photo uploaded again at full size); "" for none.
	Replaces string
}

// Confirm keeps a file the browser uploaded, removing the attachment it
// replaces. It returns the replaced one's keys, for the caller to delete
// once this commits. Confirming twice keeps it once.
func Confirm(tx *txn.Tx, owner Owner, in Arrival) (*Attachment, []string, error) {
	if a, ok, err := Attachments.Find(tx, in.ID); err != nil || ok {
		return a, nil, err
	}
	if err := owner(tx, in.OwnerID); err != nil {
		return nil, nil, err
	}
	if err := checkFile(in.Name, in.File.ContentType, in.File.Size); err != nil {
		return nil, nil, err
	}
	a := &Attachment{
		ID: in.ID, OwnerKind: in.Kind, OwnerID: in.OwnerID, Name: cleanName(in.Name),
		ContentType: in.File.ContentType, SizeBytes: in.File.Size, Key: KeyOf(in.Kind, in.OwnerID, in.ID, in.File.ContentType),
		UploadedAt: tx.Now().UTC(),
	}
	if in.OriginalBytes > in.File.Size {
		a.OriginalBytes = in.OriginalBytes
	}
	if in.Thumbnail {
		a.ThumbnailKey = ThumbnailKeyOf(in.Kind, in.OwnerID, in.ID)
	}
	var replaced []string
	if in.Replaces != "" {
		old, err := Attachments.Get(tx, in.Replaces)
		if err != nil {
			return nil, nil, err
		}
		if old.OwnerKind != in.Kind || old.OwnerID != in.OwnerID {
			return nil, nil, apperr.Invalid("A file can only replace one beside it.")
		}
		if replaced, err = Remove(tx, owner, in.Replaces); err != nil {
			return nil, nil, err
		}
	}
	return a, replaced, Attachments.Add(tx, a)
}

// Remove deletes a file attached by mistake. It returns its keys, for the
// caller to delete once this commits.
func Remove(tx *txn.Tx, owner Owner, id string) ([]string, error) {
	a, err := Attachments.Get(tx, id)
	if err != nil {
		return nil, err
	}
	if err := owner(tx, a.OwnerID); err != nil {
		return nil, err
	}
	return a.Keys(), Attachments.Delete(tx, id)
}

// RemoveAll deletes every file of an owner being deleted, returning their
// keys for the caller to delete once this commits.
func RemoveAll(tx *txn.Tx, kind OwnerKind, ownerID string) ([]string, error) {
	all, err := Of(tx, kind, ownerID)
	if err != nil {
		return nil, err
	}
	var keys []string
	for _, a := range all {
		keys = append(keys, a.Keys()...)
		if err := Attachments.Delete(tx, a.ID); err != nil {
			return nil, err
		}
	}
	return keys, nil
}

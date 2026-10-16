package attachments

import (
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/txn"
)

// Confirm keeps a file the browser uploaded, as blob storage says it
// arrived (got). Confirming twice keeps it once.
func Confirm(tx *txn.Tx, owner Owner, kind OwnerKind, ownerID, id, name string, got blobstore.Object) (*Attachment, error) {
	if a, ok, err := Attachments.Find(tx, id); err != nil || ok {
		return a, err
	}
	if err := owner(tx, ownerID); err != nil {
		return nil, err
	}
	if err := checkFile(name, got.ContentType, got.Size); err != nil {
		return nil, err
	}
	a := &Attachment{
		ID: id, OwnerKind: kind, OwnerID: ownerID, Name: cleanName(name),
		ContentType: got.ContentType, SizeBytes: got.Size, Key: KeyOf(kind, ownerID, id, got.ContentType),
		UploadedAt: tx.Now().UTC(),
	}
	return a, Attachments.Add(tx, a)
}

// Remove deletes a file attached by mistake. It returns the file's key,
// for the caller to delete once this commits.
func Remove(tx *txn.Tx, owner Owner, id string) (string, error) {
	a, err := Attachments.Get(tx, id)
	if err != nil {
		return "", err
	}
	if err := owner(tx, a.OwnerID); err != nil {
		return "", err
	}
	return a.Key, Attachments.Delete(tx, id)
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
		keys = append(keys, a.Key)
		if err := Attachments.Delete(tx, a.ID); err != nil {
			return nil, err
		}
	}
	return keys, nil
}

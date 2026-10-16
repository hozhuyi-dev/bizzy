package attachments

import (
	"fmt"

	"bizzy-lambda/internal/platform/txn"
)

// Invariants are what holds for every attachment, always. That its owner
// exists is held by the owner's feature (sessions, expenses).
var Invariants = []txn.Invariant{
	{
		ID: "files-are-what-was-checked", Why: "An attachment is a photo or PDF of a size kept, at the key its owner and id give",
		On: Attachments.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			a, ok, err := Attachments.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			if err := checkFile(a.Name, a.ContentType, a.SizeBytes); err != nil {
				return []string{fmt.Sprintf("attachment %s of %s: %v", id, describe(a), err)}, nil
			}
			if a.Key != KeyOf(a.OwnerKind, a.OwnerID, a.ID, a.ContentType) {
				return []string{fmt.Sprintf("attachment %s of %s is at %s", id, describe(a), a.Key)}, nil
			}
			return nil, nil
		},
	},
}

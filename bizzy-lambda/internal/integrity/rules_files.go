package integrity

import (
	"fmt"

	"bizzy-lambda/internal/features/attachments"
)

// FileLinks are the rules between attachments, their owners and their
// files in blob storage.
var FileLinks = []Rule{
	{
		ID:  "attachment-owner-exists",
		Why: "Every attachment belongs to something that exists",
		Broken: func(w World) []string {
			var out []string
			for _, key := range sortedKeys(w.Attachments) {
				a := w.Attachments[key]
				if !w.ownerExists(a.OwnerKind, a.OwnerID) {
					out = append(out, fmt.Sprintf("attachment %s belongs to %s %s, which doesn't exist", a.ID, a.OwnerKind, a.OwnerID))
				}
			}
			return out
		},
		GuardedBy:      []string{"attachments.confirm"},
		ByConstruction: "deleting a session or expense deletes its attachments",
	},
	{
		ID:  "attachment-has-its-file",
		Why: "Every attachment's file is in blob storage, confirmed",
		Broken: func(w World) []string {
			var out []string
			for _, key := range sortedKeys(w.Attachments) {
				a := w.Attachments[key]
				switch confirmed, ok := w.Files[a.Key]; {
				case !ok:
					out = append(out, fmt.Sprintf("attachment %s has no file at %s", a.ID, a.Key))
				case !confirmed:
					out = append(out, fmt.Sprintf("attachment %s's file is still pending, so the bucket will expire it", a.ID))
				}
			}
			return out
		},
		GuardedBy:      []string{"attachments.confirm"},
		ByConstruction: "confirm writes the item only for a file that arrived, and clears its pending tag",
	},
	{
		ID:  "owner-counts-its-files",
		Why: "A session's or expense's count of files is how many attachments it has",
		Broken: func(w World) []string {
			counts := map[string]int{}
			for _, a := range w.Attachments {
				counts[string(a.OwnerKind)+" "+a.OwnerID]++
			}
			var out []string
			for _, id := range sortedKeys(w.Sessions) {
				if got, want := w.Sessions[id].Files(), counts["session "+id]; got != want {
					out = append(out, fmt.Sprintf("session %s counts %d files, has %d", id, got, want))
				}
			}
			for _, id := range sortedKeys(w.Expenses) {
				if got, want := w.Expenses[id].Files, counts["expense "+id]; got != want {
					out = append(out, fmt.Sprintf("expense %s counts %d files, has %d", id, got, want))
				}
			}
			return out
		},
		GuardedBy:      []string{"attachments.confirm", "attachments.delete"},
		ByConstruction: "every confirm and delete recounts the owner's attachments",
	},
}

func (w World) ownerExists(kind attachments.OwnerKind, id string) bool {
	switch kind {
	case attachments.OwnerSession:
		_, ok := w.Sessions[id]
		return ok
	case attachments.OwnerExpense:
		_, ok := w.Expenses[id]
		return ok
	}
	return false
}

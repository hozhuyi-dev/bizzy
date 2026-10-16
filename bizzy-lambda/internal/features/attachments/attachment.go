// Package attachments is the files attached to things: photos, PDFs and
// scans on a session, receipts on an expense. The file itself is in blob
// storage (platform/blobstore); its metadata is an Attachment here.
//
// Uploading takes two calls around the browser's own PUT to S3: the app
// asks for an upload URL (attachments.requestUpload) with the file's name,
// type and size, uploads, then confirms (attachments.confirm), which checks
// what arrived and keeps it.
//
// A file in blob storage can't be part of a commit, so the table is
// always written first: a request that dies after it leaves at most a
// file nothing links to, which the quarterly sweep deletes (Sweep), never
// an attachment without its file.
package attachments

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// OwnerKind is what an attachment belongs to. It is part of every key, so
// it never changes once used.
type OwnerKind string

const (
	OwnerSession OwnerKind = "session"
	OwnerExpense OwnerKind = "expense"
)

// Attachment is one file's metadata; the file is in blob storage at Key.
type Attachment struct {
	ID        string    `json:"id"`
	OwnerKind OwnerKind `json:"ownerKind"`
	OwnerID   string    `json:"ownerId"`
	// Name is the file name as uploaded; it is never part of the key.
	Name        string    `json:"name"`
	ContentType string    `json:"contentType"`
	SizeBytes   int64     `json:"sizeBytes"`
	Key         string    `json:"key"`
	UploadedAt  time.Time `json:"uploadedAt"`
}

// Attachments are listed by owner.
var Attachments = txn.Kind[Attachment]{
	Name: "ATTACHMENT", Gone: "This file was already removed.",
	Doc: txn.Doc{What: "A file attached to a session or an expense; the file itself is in S3.", Time: "when it was uploaded", Ref: "its owner: <kind>:<id>"},
	Meta: func(a *Attachment) txn.Meta {
		return txn.Meta{ID: a.ID, Time: a.UploadedAt, Ref: ownerRef(a.OwnerKind, a.OwnerID)}
	},
}

func ownerRef(kind OwnerKind, id string) string { return string(kind) + ":" + id }

// Of lists an owner's files, oldest first.
func Of(tx *txn.Tx, kind OwnerKind, ownerID string) ([]*Attachment, error) {
	all, err := Attachments.WithRef(tx, ownerRef(kind, ownerID))
	slices.SortFunc(all, func(a, b *Attachment) int { return a.UploadedAt.Compare(b.UploadedAt) })
	return all, err
}

// Count is how many files an owner has.
func Count(tx *txn.Tx, kind OwnerKind, ownerID string) (int, error) {
	all, err := Attachments.WithRef(tx, ownerRef(kind, ownerID))
	return len(all), err
}

// KeyPrefix is where every attachment key starts in the bucket; the API's
// access is scoped to it (see bizzy-infra's FileBucket).
const KeyPrefix = "attachments/"

// KeyOf is where an attachment's file lives:
//
//	attachments/<ownerKind>/<ownerId>/<attachmentId>/original.<ext>
//
// Only ids, which never change and say nothing about the clients: keys
// end up in logs and URLs.
func KeyOf(kind OwnerKind, ownerID, id, contentType string) string {
	return KeyPrefix + string(kind) + "/" + ownerID + "/" + id + "/original" + Types[contentType]
}

// Types are the files that can be attached, with the extension their key
// gets. Images are shrunk in the browser before upload; HEIC (an iPhone
// photo the browser couldn't convert) is kept as it is.
var Types = map[string]string{
	"image/jpeg":      ".jpg",
	"image/png":       ".png",
	"image/webp":      ".webp",
	"image/gif":       ".gif",
	"image/heic":      ".heic",
	"image/heif":      ".heif",
	"application/pdf": ".pdf",
}

// MaxBytes is the largest file that can be attached: a long scanned PDF,
// well above a shrunk photo.
const MaxBytes = 20 << 20

// maxName bounds the file name kept, in characters.
const maxName = 200

// cleanName is the name to keep: no folders, trimmed, bounded.
func cleanName(name string) string {
	name = name[strings.LastIndexAny(name, `/\`)+1:]
	name = strings.TrimSpace(name)
	if r := []rune(name); len(r) > maxName {
		name = string(r[:maxName])
	}
	return name
}

// checkFile is the refusal for a file that can't be attached.
func checkFile(name, contentType string, size int64) error {
	switch {
	case cleanName(name) == "":
		return apperr.Invalid("The file needs a name.")
	case size <= 0:
		return apperr.Invalid("%s is empty.", name)
	case size > MaxBytes:
		return apperr.Invalid("%s is %.1f MB; files can be up to %d MB.", name, float64(size)/(1<<20), MaxBytes>>20)
	}
	if _, ok := Types[contentType]; !ok {
		var names []string
		for _, ext := range Types {
			names = append(names, strings.TrimPrefix(ext, "."))
		}
		slices.Sort(names)
		return apperr.Invalid("%s isn't a photo or PDF; attach %s files.", name, strings.Join(names, ", "))
	}
	return nil
}

// Owner says whether files can be added to or removed from one of its
// items now: an owner feature's rule (a session once it has started),
// passed in by the app, as attachments can't import the features that
// own files.
type Owner func(tx *txn.Tx, ownerID string) error

func ownerOf(owners map[OwnerKind]Owner, kind OwnerKind) (Owner, error) {
	o, ok := owners[kind]
	if !ok {
		return nil, apperr.Invalid("Files can't be attached to a %q.", kind)
	}
	return o, nil
}

func describe(a *Attachment) string { return fmt.Sprintf("%s %s", a.OwnerKind, a.OwnerID) }

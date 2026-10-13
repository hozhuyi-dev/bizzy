// Package attachments holds the files she attaches to things: photos, PDFs
// and scans on a session, receipts on an expense. The file itself is in blob
// storage (platform/blobstore); its metadata is an item here (keys:
// schema.AttachmentKeys), and the owner keeps a count of its files.
//
// Uploading takes two calls around the browser's own PUT to S3: the app asks
// for an upload URL (attachments.requestUpload) with the file's name, type
// and size, uploads, then confirms (attachments.confirm), which checks what
// arrived and writes the item. Listing one owner's files is a prefix query
// on the SK. Deleting an owner deletes its files.
package attachments

import (
	"strings"
	"time"
)

// OwnerKind is what an attachment belongs to. It is part of every key, so
// it never changes once used.
type OwnerKind string

const (
	OwnerSession OwnerKind = "session"
	OwnerExpense OwnerKind = "expense"
)

// Attachment is one file's metadata; the file itself is in blob storage
// under Key.
type Attachment struct {
	ID        string    `json:"id" dynamodbav:"id"`
	OwnerKind OwnerKind `json:"ownerKind" dynamodbav:"ownerKind"`
	OwnerID   string    `json:"ownerId" dynamodbav:"ownerId"`
	// Name is the file name as she uploaded it; it is never part of the key.
	Name        string `json:"name" dynamodbav:"name"`
	ContentType string `json:"contentType" dynamodbav:"contentType"`
	SizeBytes   int64  `json:"sizeBytes" dynamodbav:"sizeBytes"`
	// Key is where the file is in blob storage (see KeyOf).
	Key        string    `json:"key" dynamodbav:"key"`
	UploadedAt time.Time `json:"uploadedAt" dynamodbav:"uploadedAt"`
}

// View is an attachment with short-lived links to it.
type View struct {
	Attachment
	// URL shows the file in the browser; DownloadURL saves it under its name.
	URL         string `json:"url"`
	DownloadURL string `json:"downloadUrl"`
}

// KeyPrefix is where every attachment key starts in the bucket; the API's
// access is scoped to it (see bizzy-infra's FileBucket).
const KeyPrefix = "attachments/"

// KeyOf is where an attachment's file lives:
//
//	attachments/<ownerKind>/<ownerId>/<attachmentId>/original.<ext>
//
// Only ids, which never change and say nothing about her clients: keys end
// up in logs and URLs. One folder per owner deletes together; one per
// attachment leaves room for other versions of the file (a thumbnail).
func KeyOf(kind OwnerKind, ownerID, id, contentType string) string {
	return KeyPrefix + string(kind) + "/" + ownerID + "/" + id + "/original" + Types[contentType]
}

// Types are the files she can attach, with the extension their key gets.
// Images are shrunk in the browser before upload; HEIC (an iPhone photo the
// browser couldn't convert) is kept as it is.
var Types = map[string]string{
	"image/jpeg":      ".jpg",
	"image/png":       ".png",
	"image/webp":      ".webp",
	"image/gif":       ".gif",
	"image/heic":      ".heic",
	"image/heif":      ".heif",
	"application/pdf": ".pdf",
}

// MaxBytes is the largest file she can attach: a long scanned PDF, well
// above a shrunk photo.
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

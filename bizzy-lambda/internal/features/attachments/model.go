// Package attachments will hold the files she attaches to a session (and
// later other things): photos, PDFs, scans. Not built yet: this is the seam,
// so the session's record already has a place for them.
//
// When it is built: the app asks for an upload URL (blobstore.PresignPut)
// with the file's name, type and size; the browser uploads straight to S3;
// the app then confirms, and the Attachment item is written (keys:
// schema.AttachmentKeys). Listing one owner's files is a prefix query on the
// SK. Deleting a session deletes its attachments and their files.
package attachments

import "time"

// OwnerKind is what an attachment belongs to.
type OwnerKind string

const OwnerSession OwnerKind = "session"

// Attachment is one file's metadata; the file itself is in blob storage
// under Key.
type Attachment struct {
	ID        string    `json:"id" dynamodbav:"id"`
	OwnerKind OwnerKind `json:"ownerKind" dynamodbav:"ownerKind"`
	OwnerID   string    `json:"ownerId" dynamodbav:"ownerId"`
	// Name is the file name as she uploaded it.
	Name        string `json:"name" dynamodbav:"name"`
	ContentType string `json:"contentType" dynamodbav:"contentType"`
	SizeBytes   int64  `json:"sizeBytes" dynamodbav:"sizeBytes"`
	// Key is where the file is in blob storage.
	Key        string    `json:"key" dynamodbav:"key"`
	UploadedAt time.Time `json:"uploadedAt" dynamodbav:"uploadedAt"`
}

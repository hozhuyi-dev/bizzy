// Package blobstore is where files she attaches (photos, PDFs, scans) will
// live: outside DynamoDB, whose items are capped at 400 KB.
//
// Not built yet: this is the seam. The plan is one private S3 bucket per
// environment (cents a month for a practice's files). The browser uploads
// and downloads directly with short-lived presigned URLs, because the API
// Lambda is invoked directly and its payload is capped at 6 MB; only the
// metadata (attachments.Attachment) goes through the API and into the table.
package blobstore

import (
	"context"
	"time"

	"bizzy-lambda/internal/platform/apperr"
)

// Store holds file bodies by key.
type Store interface {
	// PresignPut returns a URL the browser PUTs one file to, of exactly
	// this type and size, before expiry.
	PresignPut(ctx context.Context, key, contentType string, size int64, expiry time.Duration) (string, error)
	// PresignGet returns a URL the browser reads the file from.
	PresignGet(ctx context.Context, key string, expiry time.Duration) (string, error)
	Delete(ctx context.Context, key string) error
}

// ErrUnavailable is what every call returns until storage is set up.
var ErrUnavailable = apperr.Conflict("Attaching files isn't available yet.")

// Unavailable is the Store until S3 is set up.
type Unavailable struct{}

func (Unavailable) PresignPut(context.Context, string, string, int64, time.Duration) (string, error) {
	return "", ErrUnavailable
}

func (Unavailable) PresignGet(context.Context, string, time.Duration) (string, error) {
	return "", ErrUnavailable
}

func (Unavailable) Delete(context.Context, string) error { return ErrUnavailable }

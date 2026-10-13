// Package blobstore is where files she attaches (photos, PDFs, scans)
// live: outside DynamoDB, whose items are capped at 400 KB.
//
// One private S3 bucket per environment (see bizzy-infra's FileBucket). The
// browser uploads and downloads directly with short-lived presigned URLs,
// because the API Lambda is invoked directly and its payload is capped at
// 6 MB; only the metadata (attachments.Attachment) goes through the API and
// into the table.
//
// An upload is tagged pending, and the bucket expires pending objects after
// a day. Confirming it clears the tag, so a file the app never confirmed (a
// closed tab, a failed save) cleans itself up.
package blobstore

import (
	"context"
	"errors"
	"time"

	"bizzy-lambda/internal/platform/apperr"
)

// Store holds file bodies by key.
type Store interface {
	// PresignPut returns where the browser PUTs one file, of exactly this
	// type and size, before expiry. The file starts out pending.
	PresignPut(ctx context.Context, key, contentType string, size int64, expiry time.Duration) (Upload, error)
	// PresignGet returns a URL the browser reads the file from, named
	// filename: shown inline, or saved as a download.
	PresignGet(ctx context.Context, key, filename string, download bool, expiry time.Duration) (string, error)
	// Confirm keeps an uploaded file: it reports what arrived and clears
	// its pending tag. ErrMissing when nothing was uploaded.
	Confirm(ctx context.Context, key string) (Object, error)
	// Delete removes files; a key that isn't there is no error.
	Delete(ctx context.Context, keys ...string) error
	// DeletePrefix removes every file whose key starts with prefix, for
	// resetting a test environment.
	DeletePrefix(ctx context.Context, prefix string) (int, error)
}

// Upload is a presigned PUT: the browser sends the file to URL with these
// headers, which the signature covers.
type Upload struct {
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
}

// Object is what was uploaded under a key.
type Object struct {
	Size        int64
	ContentType string
}

// ErrMissing is a key with no file.
var ErrMissing = errors.New("blobstore: no such file")

// ErrUnavailable is what every call returns when no bucket is configured.
var ErrUnavailable = apperr.Conflict("Attaching files isn't available here.")

// Unavailable is the Store when no bucket is configured.
type Unavailable struct{}

func (Unavailable) PresignPut(context.Context, string, string, int64, time.Duration) (Upload, error) {
	return Upload{}, ErrUnavailable
}

func (Unavailable) PresignGet(context.Context, string, string, bool, time.Duration) (string, error) {
	return "", ErrUnavailable
}

func (Unavailable) Confirm(context.Context, string) (Object, error) { return Object{}, ErrUnavailable }

func (Unavailable) Delete(context.Context, ...string) error { return ErrUnavailable }

func (Unavailable) DeletePrefix(context.Context, string) (int, error) { return 0, ErrUnavailable }

// Package memblob is an in-memory blobstore.Store. A test plays the browser
// by calling Put with what it would upload to a presigned URL.
package memblob

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/platform/blobstore"
)

// Blob is one stored file.
type Blob struct {
	Size        int64
	ContentType string
	Pending     bool
}

type Store struct {
	Blobs map[string]Blob
	// Presigned are the uploads the API allowed, by key, as a browser
	// could only PUT what it was given a URL for.
	Presigned map[string]Blob
}

func New() *Store {
	return &Store{Blobs: map[string]Blob{}, Presigned: map[string]Blob{}}
}

func (s *Store) PresignPut(_ context.Context, key, contentType string, size int64, _ time.Duration) (blobstore.Upload, error) {
	s.Presigned[key] = Blob{Size: size, ContentType: contentType, Pending: true}
	return blobstore.Upload{URL: "memblob://" + key, Headers: map[string]string{"Content-Type": contentType}}, nil
}

// Put uploads to a presigned URL, as the browser does: only what was
// presigned for the key.
func (s *Store) Put(key string) error {
	blob, ok := s.Presigned[key]
	if !ok {
		return fmt.Errorf("memblob: no upload presigned for %s", key)
	}
	s.Blobs[key] = blob
	return nil
}

func (s *Store) PresignGet(_ context.Context, key, _ string, _ bool, _ time.Duration) (string, error) {
	return "memblob://" + key, nil
}

func (s *Store) Confirm(_ context.Context, key string) (blobstore.Object, error) {
	blob, ok := s.Blobs[key]
	if !ok {
		return blobstore.Object{}, blobstore.ErrMissing
	}
	blob.Pending = false
	s.Blobs[key] = blob
	return blobstore.Object{Size: blob.Size, ContentType: blob.ContentType}, nil
}

func (s *Store) Delete(_ context.Context, keys ...string) error {
	for _, key := range keys {
		delete(s.Blobs, key)
	}
	return nil
}

func (s *Store) DeletePrefix(ctx context.Context, prefix string) (int, error) {
	var keys []string
	for _, key := range slices.Sorted(maps.Keys(s.Blobs)) {
		if strings.HasPrefix(key, prefix) {
			keys = append(keys, key)
		}
	}
	return len(keys), s.Delete(ctx, keys...)
}

// Expire drops pending uploads, as the bucket's lifecycle rule does after
// a day.
func (s *Store) Expire() {
	for key, blob := range s.Blobs {
		if blob.Pending {
			delete(s.Blobs, key)
		}
	}
}

// Package reset wipes her data (and her files) so a development or staging environment can
// start over against the real calendar. It is never registered in
// production, where issued invoices and receipts must be kept.
package reset

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/router"
)

type store interface {
	DeleteAll(ctx context.Context, keep ...string) (int, error)
}

// Wipe is the table and the attached files, deleted together: a file whose
// item is gone would never be reached again.
type Wipe struct {
	Table store
	Files interface {
		DeletePrefix(ctx context.Context, prefix string) (int, error)
	}
	FilesPrefix string
}

// DeleteAll deletes the table's items outside keep, then every file, and
// counts both.
func (w Wipe) DeleteAll(ctx context.Context, keep ...string) (int, error) {
	items, err := w.Table.DeleteAll(ctx, keep...)
	if err != nil {
		return items, err
	}
	files, err := w.Files.DeletePrefix(ctx, w.FilesPrefix)
	return items + files, err
}

// Sync reads the whole calendar back in, returning what it found.
type Sync func(ctx context.Context) (any, error)

// Allowed reports whether an environment may be reset. Anything that is not
// explicitly a test environment counts as production.
func Allowed(environment string) bool {
	return environment == "development" || environment == "staging"
}

type result struct {
	Deleted int `json:"deleted"`
	// Synced is the full sync's summary; SyncError says why it failed (say,
	// Google was disconnected), leaving the data reset but empty.
	Synced    any    `json:"synced,omitempty"`
	SyncError string `json:"syncError,omitempty"`
}

// Register serves data.reset, which deletes everything outside the keep
// partitions and then syncs the whole calendar back in.
func Register(r *router.Router, s store, sync Sync, keep ...string) {
	r.Mutation("data.reset", func(ctx context.Context, _ json.RawMessage) (any, error) {
		return Run(ctx, s, sync, keep...)
	})
}

// Run resets: a failed delete is an error, a failed sync is reported.
func Run(ctx context.Context, s store, sync Sync, keep ...string) (any, error) {
	deleted, err := s.DeleteAll(ctx, keep...)
	if err != nil {
		return nil, err
	}
	out := result{Deleted: deleted}
	if sync == nil {
		return out, nil
	}
	if out.Synced, err = sync(ctx); err != nil {
		slog.ErrorContext(ctx, "sync after reset", "error", err)
		out.SyncError = "The sync failed. Sync again from the nav bar."
		var appErr *apperr.Error
		if errors.As(err, &appErr) {
			out.SyncError = appErr.Message
		}
	}
	return out, nil
}

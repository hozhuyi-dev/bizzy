// Package reset starts a development or staging environment over against
// the real calendar: it deletes everything but the Google connection, and
// every attached file, then syncs the calendar back in. It is never registered in production, where
// issued invoices and receipts must be kept.
//
// It also clears data written by an older version of bizzy, which the
// current one can't read: after a breaking change to how items are stored,
// a reset is the migration.
package reset

import (
	"context"
	"errors"
	"log/slog"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/googleconnect"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/table"
)

// Allowed reports whether an environment may be reset. Anything not
// explicitly a test environment counts as production.
func Allowed(environment string) bool {
	return environment == "development" || environment == "staging"
}

// View is what a reset did.
type View struct {
	Deleted int `json:"deleted"`
	// Synced is the sync's; SyncError says why it failed (say, Google is
	// disconnected), leaving the data reset but empty.
	Synced    *googlesync.View `json:"synced,omitempty"`
	SyncError string           `json:"syncError,omitempty"`
}

// Routes registers data.reset.
func Routes(r *router.Router, tb table.Table, blobs blobstore.Store, sync *googlesync.Sync) {
	r.Mutation("data.reset", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		deleted, err := tb.Wipe(ctx, googleconnect.Connections.Name)
		if err != nil {
			return nil, err
		}
		files, err := blobs.DeletePrefix(ctx, attachments.KeyPrefix)
		if err != nil {
			return nil, err
		}
		out := View{Deleted: deleted + files}
		synced, err := sync.Run(ctx)
		if err != nil {
			slog.ErrorContext(ctx, "sync after reset", "error", err)
			out.SyncError = "The sync failed. Sync again from the nav bar."
			var shown *apperr.Error
			if errors.As(err, &shown) {
				out.SyncError = shown.Message
			}
			return out, nil
		}
		v := googlesync.ViewOf(synced)
		out.Synced = &v
		return out, nil
	}))
}

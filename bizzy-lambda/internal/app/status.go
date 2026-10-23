package app

import (
	"context"

	"bizzy-lambda/internal/features/googleconnect"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// StatusView is what every page shows around it, read in one call: the
// Google connection (nil before the user connects), what Settings still
// needs, and the last sync (nil before the first).
type StatusView struct {
	Google *googleconnect.View `json:"google"`
	Gaps   settings.GapsView   `json:"gaps"`
	Sync   *googlesync.View    `json:"sync"`
}

// statusRoutes registers app.status. auth is nil in tests, which don't ask
// Google whether it still accepts the connection.
func statusRoutes(r *router.Router, run *txn.Runner, auth googleconnect.Auth) {
	r.Query("app.status", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		var conn *googleconnect.Connection
		v, err := txn.Read(ctx, run, func(tx *txn.Tx) (StatusView, error) {
			var v StatusView
			var err error
			if conn, err = googleconnect.Current(tx); err != nil {
				return v, err
			}
			if v.Gaps, err = settings.GapsOf(tx); err != nil {
				return v, err
			}
			v.Sync, err = googlesync.Last(tx)
			return v, err
		})
		if err != nil {
			return nil, err
		}
		v.Google = googleconnect.StatusOf(ctx, conn, auth)
		return v, nil
	}))
}

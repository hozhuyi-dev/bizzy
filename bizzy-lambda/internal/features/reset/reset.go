// Package reset wipes her data so a development or staging environment can
// start over against the real calendar. It is never registered in
// production.
package reset

import (
	"context"
	"encoding/json"

	"bizzy-lambda/internal/router"
)

type store interface {
	DeleteAll(ctx context.Context, keep ...string) (int, error)
}

// Allowed reports whether an environment may be reset. Anything that is not
// explicitly a test environment counts as production.
func Allowed(environment string) bool {
	return environment == "development" || environment == "staging"
}

type result struct {
	Deleted int `json:"deleted"`
}

// Register serves data.reset, which deletes everything outside the keep
// partitions.
func Register(r *router.Router, s store, keep ...string) {
	r.Register("data.reset", func(ctx context.Context, _ json.RawMessage) (any, error) {
		deleted, err := s.DeleteAll(ctx, keep...)
		if err != nil {
			return nil, err
		}
		return result{Deleted: deleted}, nil
	})
}

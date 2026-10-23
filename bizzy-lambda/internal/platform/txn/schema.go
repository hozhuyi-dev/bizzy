package txn

import (
	"context"
	"encoding/json"
	"log/slog"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/table"
)

// The schema is which migrations (internal/migrations) the stored items
// have been through. A Runner serves only a table at its own Schema
// version, so code never reads items shaped for other code: after a
// deploy, the new code refuses everything until the migrations have run,
// and the old code, still finishing requests, refuses everything once
// they start (see platform/migrate).

// SchemaKey is the item that holds the table's Schema. Without it, the
// table is at version 0.
var SchemaKey = table.Key{PK: "SCHEMA", SK: "VERSION"}

// Schema is how far the stored items have been migrated.
type Schema struct {
	// Version is how many migrations have run.
	Version int `json:"version"`
	// Migrating is set while migrations run: only the migrator's Runner
	// serves the table.
	Migrating bool `json:"migrating,omitempty"`
}

// ReadSchema reads the table's Schema.
func ReadSchema(ctx context.Context, tb table.Table) (Schema, error) {
	var s Schema
	it, ok, err := tb.Get(ctx, SchemaKey)
	if err != nil || !ok {
		return s, err
	}
	return s, json.Unmarshal(it.Data, &s)
}

// SchemaItem is the item that stores a Schema.
func SchemaItem(s Schema) table.Item {
	data, _ := json.Marshal(s)
	return table.Item{Key: SchemaKey, Data: data}
}

// errUpdating is what the app shows while the table and the code are at
// different versions: for the seconds a deploy's migrations take.
var errUpdating = apperr.Unavailable("bizzy is being updated. Try again in a minute.")

// checkSchema refuses a table at another version than the Runner's, or
// one being migrated, unless the Runner is the migrator's.
func (r *Runner) checkSchema(tx *Tx) error {
	if r.Migrator {
		return nil
	}
	var s Schema
	it, ok, err := tx.get(SchemaKey, false)
	if err == nil && ok {
		err = json.Unmarshal(it.Data, &s)
	}
	if err != nil {
		return err
	}
	if s.Migrating || s.Version != r.Schema {
		slog.WarnContext(tx.ctx, "the table isn't at the code's schema", "table", s.Version, "migrating", s.Migrating, "code", r.Schema)
		return errUpdating
	}
	return nil
}

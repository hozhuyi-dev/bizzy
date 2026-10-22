// Package migrate changes how stored items are shaped, as SQL migrations
// do: a numbered list of Migrations (internal/migrations), each run once,
// in order, by a deploy (cmd/migrate). The table records how many have run
// (txn.Schema), and a txn.Runner serves only a table at its own version,
// so the code always reads items in the shape it writes them.
//
// Run, when migrations are pending:
//
//  1. Backs the table up.
//  2. Raises the fence (Schema.Migrating): every Runner but the
//     migrator's refuses the table, so nothing else writes meanwhile.
//  3. Runs each pending migration, recording the version after each.
//  4. Reviews every stored item: it must read as the code reads it (see
//     review.go). Then it rewrites each the code would write differently
//     (its JSON, its index keys), and checks every invariant.
//  5. Lowers the fence.
//
// A failure leaves the fence up: the app says it is being updated until a
// fixed migration runs (or the backup is restored). So a migration must
// be safe to run again over items it already changed.
//
// A migration works on items as stored JSON (see Tx), never on a
// feature's types: those go on changing after it is written, and a later
// migration may change its output again. Only the review, after the last
// migration, reads items as the code's types.
//
// Every change to a stored type or to where a kind files its items (its
// Meta) needs a migration, if only one with no Up: the code reads only
// items stored exactly as it writes them (see txn.Kind.Rewrite), and the
// rewrite in step 4 is what makes them so.
//
// DryRun does the same on a copy of the table in memory: what a deploy
// would do, writing nothing.
package migrate

import (
	"context"
	"fmt"

	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
)

// Migration is one change to how items are stored, taking the table from
// the version before it to its own.
type Migration struct {
	// Name says what it changes, e.g. "split fee rates by date".
	Name string
	// Up changes the items. Nil leaves them to the rewrite that follows
	// every run (see Run): enough for a new field, or a change to Meta.
	Up func(m *Tx) error
}

// Apply runs the migration's Up on a table, committing what it writes, and
// returns how many items it wrote.
func (mig Migration) Apply(ctx context.Context, tb table.Table) (int, error) {
	if mig.Up == nil {
		return 0, nil
	}
	m := &Tx{ctx: ctx, table: tb}
	if err := mig.Up(m); err != nil {
		return m.written, err
	}
	return m.written, m.flush()
}

type Options struct {
	// Runner is the app's: its Table is the one migrated, and its
	// Invariants are checked once the migrations have run.
	Runner *txn.Runner
	// Kinds are every kind stored (app.Kinds).
	Kinds []txn.AnyKind
	// Migrations are every migration, oldest first (migrations.All).
	Migrations []Migration
	// Backup, when set, backs the table up before anything is written.
	Backup func(ctx context.Context, name string) error
}

// Report is what a run did.
type Report struct {
	From    int      `json:"from"`
	To      int      `json:"to"`
	Applied []string `json:"applied,omitempty"`
	// Written counts the items written; Reviewed those read in review.
	Written  int `json:"written"`
	Reviewed int `json:"reviewed"`
}

// Run brings the table to the version of the code: len(Migrations).
func Run(ctx context.Context, o Options) (Report, error) {
	tb := o.Runner.Table
	s, err := txn.ReadSchema(ctx, tb)
	if err != nil {
		return Report{}, err
	}
	rep := Report{From: s.Version, To: s.Version}
	if s.Version > len(o.Migrations) {
		return rep, fmt.Errorf("migrate: the table is at version %d, past this code's %d: deploy newer code", s.Version, len(o.Migrations))
	}
	pending := o.Migrations[s.Version:]

	// Nothing to run: only make sure the code can read what is stored.
	if len(pending) == 0 && !s.Migrating {
		r, err := review(ctx, o)
		rep.Reviewed = r.reviewed
		if err == nil && len(r.stale) > 0 {
			err = fmt.Errorf("migrate: %d items aren't stored as the code writes them: a change to a stored type or a Meta needs a migration (one with no Up will do)", len(r.stale))
		}
		return rep, err
	}

	if o.Backup != nil {
		if err := o.Backup(ctx, fmt.Sprintf("before-v%d", len(o.Migrations))); err != nil {
			return rep, fmt.Errorf("migrate: back up: %w", err)
		}
	}
	if err := setSchema(ctx, tb, txn.Schema{Version: s.Version, Migrating: true}); err != nil {
		return rep, err
	}
	for i, mig := range pending {
		version := s.Version + i + 1
		written, err := mig.Apply(ctx, tb)
		rep.Written += written
		if err != nil {
			return rep, fmt.Errorf("migrate: %d (%s): %w", version, mig.Name, err)
		}
		if err := setSchema(ctx, tb, txn.Schema{Version: version, Migrating: true}); err != nil {
			return rep, err
		}
		rep.To = version
		rep.Applied = append(rep.Applied, fmt.Sprintf("%d %s", version, mig.Name))
	}

	r, err := review(ctx, o)
	rep.Reviewed = r.reviewed
	if err != nil {
		return rep, err
	}
	rewritten, err := rewrite(ctx, tb, r.stale)
	rep.Written += rewritten
	if err != nil {
		return rep, err
	}
	if err := checkInvariants(ctx, o); err != nil {
		return rep, err
	}
	return rep, setSchema(ctx, tb, txn.Schema{Version: rep.To})
}

// DryRun is Run on a copy of the table in memory: what a deploy would do,
// with nothing written and no backup taken.
func DryRun(ctx context.Context, o Options) (Report, error) {
	items, err := o.Runner.Table.Scan(ctx)
	if err != nil {
		return Report{}, err
	}
	copied := table.NewMemory()
	copied.Load(items...)
	r := *o.Runner
	r.Table = copied
	o.Runner, o.Backup = &r, nil
	return Run(ctx, o)
}

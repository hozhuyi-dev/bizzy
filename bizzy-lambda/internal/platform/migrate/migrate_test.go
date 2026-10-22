package migrate_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/migrate"
	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
)

// book is the code's type now; version 0 stored "name" where it has
// "title".
type book struct {
	ID    string    `json:"id"`
	Title string    `json:"title"`
	At    time.Time `json:"at"`
}

var books = txn.Kind[book]{
	Name: "BOOK", Gone: "That book is gone.",
	Meta: func(b *book) txn.Meta { return txn.Meta{ID: b.ID, Time: b.At} },
}

var at = time.Date(2026, 10, 13, 0, 0, 0, 0, time.UTC)

// renameTitle is migration 1.
var renameTitle = migrate.Migration{
	Name: "rename name to title",
	Up: migrate.EachItem("BOOK", func(_ string, f migrate.Fields) (bool, error) {
		name, ok := f["name"]
		if !ok {
			return false, nil
		}
		f["title"] = name
		delete(f, "name")
		return true, nil
	}),
}

var titled = txn.Invariant{
	ID: "books-have-titles", Why: "Every book has a title", On: "BOOK",
	Broken: func(tx *txn.Tx, id string) ([]string, error) {
		b, ok, err := books.Find(tx, id)
		if err != nil || !ok || b.Title != "" {
			return nil, err
		}
		return []string{id}, nil
	},
}

// setup is a table at version 0 holding n books as version 0 stored them,
// and the options to migrate it to version 1.
func setup(t *testing.T, n int) (*table.Memory, migrate.Options) {
	t.Helper()
	mem := table.NewMemory()
	for i := range n {
		id := fmt.Sprintf("b%03d", i)
		data := fmt.Sprintf(`{"id":%q,"name":"Book %d","at":%q}`, id, i, at.Format(time.RFC3339))
		mem.Load(table.Item{Key: table.Key{PK: "BOOK", SK: id}, Data: []byte(data)})
	}
	return mem, migrate.Options{
		Runner: &txn.Runner{
			Table: mem, Invariants: []txn.Invariant{titled}, Location: time.UTC, Schema: 1,
			Now: func() time.Time { return at }, NewID: func() string { return "" },
		},
		Kinds:      []txn.AnyKind{books},
		Migrations: []migrate.Migration{renameTitle},
	}
}

func schemaOf(t *testing.T, tb table.Table) txn.Schema {
	t.Helper()
	s, err := txn.ReadSchema(context.Background(), tb)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// served reports whether the app's Runner serves the table, and fails on
// any refusal but the fence's.
func served(t *testing.T, r *txn.Runner) bool {
	t.Helper()
	_, err := txn.Read(context.Background(), r, func(tx *txn.Tx) ([]*book, error) { return books.All(tx) })
	var shown *apperr.Error
	if errors.As(err, &shown) && shown.Code == apperr.CodeUnavailable {
		return false
	}
	if err != nil {
		t.Fatal(err)
	}
	return true
}

func TestRunMigratesFilesAndLowersTheFence(t *testing.T) {
	ctx := context.Background()
	// More than one commit's worth, to cross batches.
	mem, o := setup(t, table.MaxWrites+20)
	if served(t, o.Runner) {
		t.Fatal("the code served a table at an older version")
	}
	var backups []string
	o.Backup = func(_ context.Context, name string) error { backups = append(backups, name); return nil }

	rep, err := migrate.Run(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	if rep.From != 0 || rep.To != 1 || len(rep.Applied) != 1 || len(backups) != 1 {
		t.Errorf("report %+v, backups %v; want 0 → 1, backed up once", rep, backups)
	}
	if s := schemaOf(t, mem); s != (txn.Schema{Version: 1}) {
		t.Errorf("schema = %+v, want version 1, fence down", s)
	}
	it, _, _ := mem.Get(ctx, table.Key{PK: "BOOK", SK: "b007"})
	if !strings.Contains(string(it.Data), `"title":"Book 7"`) || it.Time != txn.TimeKey(at) {
		t.Errorf("b007 = %s filed at %q; want its title, filed by time", it.Data, it.Time)
	}
	if !served(t, o.Runner) {
		t.Error("the code doesn't serve the migrated table")
	}

	// A deploy with nothing pending changes nothing.
	before := mem.Dump()
	if rep, err := migrate.Run(ctx, o); err != nil || len(rep.Applied) != 0 || string(mem.Dump()) != string(before) {
		t.Errorf("second run: %+v, %v; want nothing done", rep, err)
	}
}

func TestAFailedRunLeavesTheFenceUpUntilAFixedOneRuns(t *testing.T) {
	ctx := context.Background()
	mem, o := setup(t, 3)
	o.Migrations = []migrate.Migration{{Name: "broken", Up: func(*migrate.Tx) error { return errors.New("oops") }}}
	if _, err := migrate.Run(ctx, o); err == nil {
		t.Fatal("a failing migration ran")
	}
	if s := schemaOf(t, mem); s != (txn.Schema{Migrating: true}) {
		t.Errorf("schema = %+v, want the fence up at version 0", s)
	}
	if served(t, o.Runner) {
		t.Error("the code served a half-migrated table")
	}

	o.Migrations = []migrate.Migration{renameTitle}
	if _, err := migrate.Run(ctx, o); err != nil {
		t.Fatal(err)
	}
	if !served(t, o.Runner) {
		t.Error("the fixed run didn't lower the fence")
	}
}

func TestTheReviewRefusesWhatTheCodeCantRead(t *testing.T) {
	ctx := context.Background()

	t.Run("after migrating, keeping the fence up", func(t *testing.T) {
		mem, o := setup(t, 2)
		o.Migrations = []migrate.Migration{{Name: "forgets the rename"}}
		_, err := migrate.Run(ctx, o)
		if err == nil || !strings.Contains(err.Error(), `unknown field "name"`) {
			t.Fatalf("err = %v, want the unknown field named", err)
		}
		if !schemaOf(t, mem).Migrating {
			t.Error("the fence came down over items the code can't read")
		}
	})

	t.Run("with nothing to run, leaving the fence down", func(t *testing.T) {
		mem, o := setup(t, 2)
		o.Migrations, o.Runner.Schema = nil, 0
		if _, err := migrate.Run(ctx, o); err == nil {
			t.Fatal("items the code can't read passed the review")
		}
		if schemaOf(t, mem).Migrating {
			t.Error("a review with nothing to run raised the fence")
		}
	})
}

func TestABrokenInvariantKeepsTheFenceUp(t *testing.T) {
	mem, o := setup(t, 2)
	o.Migrations = []migrate.Migration{{Name: "blank titles", Up: migrate.EachItem("BOOK", func(_ string, f migrate.Fields) (bool, error) {
		delete(f, "name")
		f["title"] = ""
		return true, nil
	})}}
	_, err := migrate.Run(context.Background(), o)
	if err == nil || !strings.Contains(err.Error(), "books-have-titles") {
		t.Fatalf("err = %v, want the broken invariant named", err)
	}
	if !schemaOf(t, mem).Migrating {
		t.Error("the fence came down over broken items")
	}
}

func TestAChangeOfWhereItemsAreFiledNeedsAMigration(t *testing.T) {
	ctx := context.Background()
	mem, o := setup(t, 0)
	// Stored in the current shape, but unfiled: as if Meta had changed.
	mem.Load(table.Item{Key: table.Key{PK: "BOOK", SK: "b1"}, Data: []byte(`{"id":"b1","title":"T","at":"2026-10-13T00:00:00Z"}`)})
	o.Migrations, o.Runner.Schema = nil, 0
	if _, err := migrate.Run(ctx, o); err == nil || !strings.Contains(err.Error(), "needs a migration") {
		t.Fatalf("err = %v, want a migration asked for", err)
	}

	o.Migrations, o.Runner.Schema = []migrate.Migration{{Name: "file books by time"}}, 1
	if _, err := migrate.Run(ctx, o); err != nil {
		t.Fatal(err)
	}
	if it, _, _ := mem.Get(ctx, table.Key{PK: "BOOK", SK: "b1"}); it.Time == "" {
		t.Error("a migration with no Up didn't rewrite the items")
	}
}

func TestDryRunWritesNothing(t *testing.T) {
	mem, o := setup(t, 3)
	before := mem.Dump()
	o.Backup = func(context.Context, string) error { t.Error("a dry run took a backup"); return nil }
	rep, err := migrate.DryRun(context.Background(), o)
	if err != nil || rep.To != 1 || rep.Written == 0 {
		t.Fatalf("dry run: %+v, %v; want it to migrate the copy", rep, err)
	}
	if string(mem.Dump()) != string(before) {
		t.Error("a dry run wrote to the table")
	}
}

func TestRunRefusesATableNewerThanTheCode(t *testing.T) {
	ctx := context.Background()
	mem, o := setup(t, 0)
	newer, _ := json.Marshal(txn.Schema{Version: 2})
	mem.Load(table.Item{Key: txn.SchemaKey, Data: newer})
	if _, err := migrate.Run(ctx, o); err == nil || !strings.Contains(err.Error(), "past this code's") {
		t.Fatalf("err = %v, want old code refused", err)
	}
}

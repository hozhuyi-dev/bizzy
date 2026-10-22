package app_test

import (
	"flag"
	"fmt"
	"os"
	"regexp"
	"strings"
	"testing"

	"bizzy-lambda/internal/app"
	"bizzy-lambda/internal/migrations"
)

var update = flag.Bool("update", false, "rewrite SCHEMA.md")

// TestSchema renders the DynamoDB schema from the code (every kind, its
// stored fields, its indexes and the invariants that tie the kinds
// together) and checks bizzy-lambda/SCHEMA.md says it. Run with -update to
// rewrite it; the diff is the schema change. It refuses to while a kind's
// stored fields changed with no new migration.
func TestSchema(t *testing.T) {
	got := schema(t)
	const path = "../../SCHEMA.md"
	if *update {
		if old, err := os.ReadFile(path); err == nil {
			if kind := changedWithoutMigration(string(old), got); kind != "" {
				t.Fatalf("%s's stored fields changed with no migration: add one to internal/migrations (one with no Up will do if no item needs changing by hand), then -update again", kind)
			}
		}
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (run with -update to write it)", err)
	}
	if strings.ReplaceAll(string(want), "\r\n", "\n") != got {
		t.Error("SCHEMA.md is out of date: run go test ./internal/app -run TestSchema -update, and review the diff")
	}
}

func schema(t *testing.T) string {
	var b strings.Builder
	b.WriteString("# bizzy's DynamoDB schema\n\n")
	b.WriteString("Generated from the code by `internal/app/schema_test.go`; do not edit. Rewrite it with\n`go test ./internal/app -run TestSchema -update` and review the diff.\n\n")
	b.WriteString("One table (see `internal/platform/table`). Every item has `PK` = its kind, `SK` = its id, its fields as JSON in `data`, and a sort key in each index it is filed in. Each index has one meaning for every kind, and is sparse: an item is in it only if its kind files it there.\n\n")
	b.WriteString("| Index | Sort key | Lists |\n|---|---|---|\n")
	b.WriteString("| LSI1 | `<time>` | by time (`Kind.Between`) |\n")
	b.WriteString("| LSI2 | `<clientId>#<time>` | a client's items (`Kind.OfClient`) |\n")
	b.WriteString("| LSI3 | `<time>` | open items, for the to-do list (`Kind.Open`) |\n")
	b.WriteString("| LSI4 | `<tag>#<time>` | by tag (`Kind.Tagged`) |\n")
	b.WriteString("| LSI5 | `<ref>` | by what they refer to (`Kind.WithRef`) |\n\n")
	b.WriteString("Every commit also moves one counter (`PK COMMIT`, `SK COUNTER`), which makes commits happen one at a time (see `internal/platform/txn`).\n\n")
	b.WriteString("One item (`PK SCHEMA`, `SK VERSION`) holds how many migrations the items have been through, and the fence while they run (see `internal/platform/migrate`).\n\n")
	fmt.Fprintf(&b, "%s %d\n\n", versionLabel, migrations.Version)

	invariants := app.Invariants()
	b.WriteString("## Kinds\n")
	for _, k := range app.Kinds() {
		d := k.KindDoc()
		if d.What == "" {
			t.Errorf("kind %s says nothing of what it is: give it a Doc", k.KindName())
		}
		fmt.Fprintf(&b, "\n### %s\n\n%s\n\n| Field | Type |\n|---|---|\n", k.KindName(), d.What)
		for _, f := range k.Fields() {
			fmt.Fprintf(&b, "| %s | `%s` |\n", f.Name, f.Type)
		}
		var filed []string
		for _, ix := range []struct{ name, meaning string }{
			{"LSI1 time", d.Time}, {"LSI2 client", d.Client}, {"LSI3 open", d.Open}, {"LSI4 tag", d.Tag}, {"LSI5 ref", d.Ref},
		} {
			if ix.meaning != "" {
				filed = append(filed, fmt.Sprintf("| %s | %s |", ix.name, ix.meaning))
			}
		}
		if len(filed) > 0 {
			fmt.Fprintf(&b, "\n| Index | For it |\n|---|---|\n%s\n", strings.Join(filed, "\n"))
		}
		var rules []string
		for _, inv := range invariants {
			if inv.On == k.KindName() {
				rules = append(rules, fmt.Sprintf("- **%s**: %s", inv.ID, inv.Why))
			}
		}
		if len(rules) > 0 {
			fmt.Fprintf(&b, "\nChecked on every change to one:\n\n%s\n", strings.Join(rules, "\n"))
		}
	}
	return b.String()
}

// versionLabel starts the line of SCHEMA.md that gives migrations.Version.
const versionLabel = "Schema version (migrations in `internal/migrations`):"

// changedWithoutMigration is a kind whose stored fields differ between two
// renderings of the schema at the same version; "" when there is none. A
// new kind needs no migration: nothing of it is stored yet.
func changedWithoutMigration(old, now string) string {
	if versionOf(old) != versionOf(now) {
		return ""
	}
	before, after := storedFields(old), storedFields(now)
	for kind, fields := range before {
		if after[kind] != fields {
			return kind
		}
	}
	return ""
}

func versionOf(schema string) string {
	for _, line := range strings.Split(schema, "\n") {
		if strings.HasPrefix(line, versionLabel) {
			return strings.TrimSpace(line)
		}
	}
	return ""
}

// fieldRow is a row of a kind's field table: "| name | `type` |".
var fieldRow = regexp.MustCompile("^\\| \\S+ \\| `[^`]*` \\|$")

// storedFields are each kind's field rows in a rendering of the schema.
func storedFields(schema string) map[string]string {
	out := map[string]string{}
	kind := ""
	for _, line := range strings.Split(strings.ReplaceAll(schema, "\r\n", "\n"), "\n") {
		switch {
		case strings.HasPrefix(line, "### "):
			kind = strings.TrimPrefix(line, "### ")
		case kind != "" && fieldRow.MatchString(line):
			out[kind] += line + "\n"
		}
	}
	return out
}

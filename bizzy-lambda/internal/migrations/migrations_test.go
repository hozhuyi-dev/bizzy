package migrations_test

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"testing"

	"bizzy-lambda/internal/migrations"
	"bizzy-lambda/internal/platform/table"
)

// fixture is one item of a testdata file: its key, and its fields as
// stored. Index keys are left out: the rewrite after every run sets them.
type fixture struct {
	PK   string          `json:"pk"`
	SK   string          `json:"sk"`
	Data json.RawMessage `json:"data"`
}

// TestEachMigrationTurnsItsBeforeIntoItsAfter runs migration NNN on
// testdata/NNN/before.json and checks it leaves after.json, and that
// running it again over its own output changes nothing.
func TestEachMigrationTurnsItsBeforeIntoItsAfter(t *testing.T) {
	ctx := context.Background()
	for i, mig := range migrations.All {
		if mig.Up == nil {
			continue
		}
		dir := filepath.Join("testdata", fmt.Sprintf("%03d", i+1))
		t.Run(fmt.Sprintf("%03d %s", i+1, mig.Name), func(t *testing.T) {
			mem := table.NewMemory()
			for _, f := range readFixtures(t, filepath.Join(dir, "before.json")) {
				mem.Load(table.Item{Key: table.Key{PK: f.PK, SK: f.SK}, Data: f.Data})
			}
			want := stored(t, readFixtures(t, filepath.Join(dir, "after.json")))
			for _, run := range []string{"first", "again"} {
				if _, err := mig.Apply(ctx, mem); err != nil {
					t.Fatalf("%s run: %v", run, err)
				}
				items, _ := mem.Scan(ctx)
				var got []fixture
				for _, it := range items {
					got = append(got, fixture{PK: it.PK, SK: it.SK, Data: it.Data})
				}
				if g := stored(t, got); !maps.Equal(g, want) {
					t.Errorf("%s run left\n%v\nwant\n%v", run, g, want)
				}
			}
		})
	}
}

func readFixtures(t *testing.T, path string) []fixture {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v: each migration with an Up has testdata/NNN/before.json and after.json", err)
	}
	var out []fixture
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	return out
}

// stored is each item's data by key, in one encoding (object keys sorted),
// so that items compare by what they say.
func stored(t *testing.T, items []fixture) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, it := range items {
		var v any
		if err := json.Unmarshal(it.Data, &v); err != nil {
			t.Fatalf("%s %s: %v", it.PK, it.SK, err)
		}
		canonical, _ := json.Marshal(v)
		out[it.PK+" "+it.SK] = string(canonical)
	}
	return out
}

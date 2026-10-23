// Package tabletest is the behaviour every Table must have. The memory
// table runs it in every test run; the DynamoDB one runs it against a real
// table when one is given (see platform/dynamo), so the simulation, which
// runs on the memory table, says something about production too.
package tabletest

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"bizzy-lambda/internal/platform/table"
)

// Run checks a table. newTable returns a table for one test, and a prefix
// for its partitions that no other test uses: a fresh memory table and "",
// or a shared real table and a random prefix.
func Run(t *testing.T, newTable func(t *testing.T) (table.Table, string)) {
	ctx := context.Background()
	var pk string
	versions := func() table.Key { return table.Key{PK: pk + "COUNTER", SK: "commits"} }
	thing := func() string { return pk + "THING" }
	// commit writes as a first commit to THING would.
	commit := func(tb table.Table, writes ...table.Write) error {
		_, err := tb.Commit(ctx, versions(), table.Versions{thing(): 0}, writes)
		return err
	}
	item := func(sk string, ix table.Indexes) table.Item {
		return table.Item{Key: table.Key{PK: pk + "THING", SK: sk}, Indexes: ix, Data: []byte(fmt.Sprintf(`{"id":%q}`, sk))}
	}
	open := func(t *testing.T) table.Table {
		tb, prefix := newTable(t)
		pk = prefix
		return tb
	}
	put := func(it table.Item) table.Write { return table.Write{Put: &it} }
	keys := func(items []table.Item) []string {
		var out []string
		for _, it := range items {
			out = append(out, it.SK)
		}
		return out
	}

	t.Run("a commit moves what it writes on and writes everything", func(t *testing.T) {
		tb := open(t)
		a, b := item("a", table.Indexes{Time: "2026-10-02"}), item("b", table.Indexes{Time: "2026-10-01"})
		moved, err := tb.Commit(ctx, versions(), table.Versions{thing(): 0, pk + "OTHER": 0}, []table.Write{put(a), put(b)})
		if err != nil {
			t.Fatal(err)
		}
		now, err := tb.Versions(ctx, versions())
		if err != nil || now[thing()] == 0 || now[thing()] != moved[thing()] || now[pk+"OTHER"] != 0 {
			t.Fatalf("versions = %v, %v (commit said %v); want THING moved on, OTHER, only read, not", now, err, moved)
		}
		got, ok, err := tb.Get(ctx, a.Key)
		if err != nil || !ok || string(got.Data) != string(a.Data) || got.Time != a.Time {
			t.Fatalf("get = %+v, %v, %v; want %+v", got, ok, err, a)
		}
		again, err := tb.Commit(ctx, versions(), now, []table.Write{put(a)})
		if err != nil || again[thing()] != now[thing()]+1 {
			t.Fatalf("second commit moved THING to %v, %v; want %d", again, err, now[thing()]+1)
		}
	})

	t.Run("a commit after what it read moved writes nothing", func(t *testing.T) {
		tb := open(t)
		if err := commit(tb, put(item("a", table.Indexes{}))); err != nil {
			t.Fatal(err)
		}
		err := commit(tb, put(item("b", table.Indexes{})))
		if !errors.Is(err, table.ErrConflict) {
			t.Fatalf("err = %v, want ErrConflict", err)
		}
		if _, ok, _ := tb.Get(ctx, table.Key{PK: thing(), SK: "b"}); ok {
			t.Fatal("a refused commit wrote")
		}
		// One that read only other partitions goes through.
		other := item("c", table.Indexes{})
		other.PK = pk + "OTHER"
		if _, err := tb.Commit(ctx, versions(), table.Versions{other.PK: 0}, []table.Write{put(other)}); err != nil {
			t.Fatalf("a commit of another partition: %v", err)
		}
	})

	t.Run("queries read an index in order, sparse and bounded", func(t *testing.T) {
		tb := open(t)
		writes := []table.Write{
			put(item("a", table.Indexes{Time: "2026-10-03", Client: "jane#2026-10-03", Ref: "e1"})),
			put(item("b", table.Indexes{Time: "2026-10-01", Client: "bob#2026-10-01", Ref: "e10"})),
			put(item("c", table.Indexes{Time: "2026-10-02", Client: "jane#2026-10-02"})),
			put(item("d", table.Indexes{})),
		}
		if err := commit(tb, writes...); err != nil {
			t.Fatal(err)
		}
		for _, c := range []struct {
			q    table.Query
			want []string
		}{
			{table.Query{PK: pk + "THING"}, []string{"a", "b", "c", "d"}},
			{table.Query{PK: pk + "THING", Index: table.ByTime}, []string{"b", "c", "a"}},
			{table.Query{PK: pk + "THING", Index: table.ByTime, From: "2026-10-02", To: "2026-10-03"}, []string{"c", "a"}},
			{table.Query{PK: pk + "THING", Index: table.ByClient, Prefix: "jane#"}, []string{"c", "a"}},
			{table.Query{PK: pk + "THING", Index: table.ByRef, Equals: "e1"}, []string{"a"}},
		} {
			got, err := tb.Query(ctx, c.q)
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(keys(got), c.want) {
				t.Errorf("%+v = %v, want %v", c.q, keys(got), c.want)
			}
		}
	})

	t.Run("a query reads backwards, and a page at a time", func(t *testing.T) {
		tb := open(t)
		// Two pairs share a time: a page can end between them.
		var writes []table.Write
		for i, at := range []string{"2026-10-01", "2026-10-02", "2026-10-02", "2026-10-03", "2026-10-03", "2026-10-04"} {
			writes = append(writes, put(item(fmt.Sprintf("i%d", i), table.Indexes{Time: at})))
		}
		if err := commit(tb, writes...); err != nil {
			t.Fatal(err)
		}
		for _, desc := range []bool{false, true} {
			q := table.Query{PK: pk + "THING", Index: table.ByTime, To: "2026-10-03", Desc: desc}
			all, err := tb.Query(ctx, q)
			if err != nil {
				t.Fatal(err)
			}
			if len(all) != 5 {
				t.Fatalf("desc %v: %v, want the five up to 2026-10-03", desc, keys(all))
			}
			if desc && all[0].Time != "2026-10-03" {
				t.Errorf("backwards: %v, want the latest first", keys(all))
			}
			var paged []table.Item
			q.Limit = 2
			for {
				page, err := tb.Query(ctx, q)
				if err != nil {
					t.Fatal(err)
				}
				paged = append(paged, page...)
				if len(page) < q.Limit {
					break
				}
				after := table.PlaceOf(q.Index, page[len(page)-1])
				q.After = &after
			}
			if !slices.Equal(keys(paged), keys(all)) {
				t.Errorf("desc %v: by pages %v, at once %v", desc, keys(paged), keys(all))
			}
		}
	})

	t.Run("a wipe deletes everything outside the kept partitions", func(t *testing.T) {
		tb := open(t)
		kept := item("k", table.Indexes{})
		kept.PK = pk + "KEPT"
		// An item an older version wrote, which this one can't read.
		stale := table.Item{Key: table.Key{PK: kept.PK, SK: "old"}}
		if _, err := tb.Commit(ctx, versions(), table.Versions{thing(): 0, kept.PK: 0}, []table.Write{put(item("a", table.Indexes{Time: "x"})), put(kept), put(stale)}); err != nil {
			t.Fatal(err)
		}
		n, err := tb.Wipe(ctx, versions(), kept.PK)
		if err != nil {
			t.Fatal(err)
		}
		if _, ok, _ := tb.Get(ctx, kept.Key); !ok {
			t.Error("the kept item went")
		}
		if got, _ := tb.Query(ctx, table.Query{PK: kept.PK}); len(got) != 1 {
			t.Errorf("kept partition = %v, want the old item gone", keys(got))
		}
		if got, _ := tb.Query(ctx, table.Query{PK: pk + "THING"}); len(got) != 0 {
			t.Errorf("still there: %v", keys(got))
		}
		if v, _ := tb.Versions(ctx, versions()); len(v) != 1 || v[kept.PK] == 0 || n < 2 {
			t.Errorf("versions = %v, deleted %d; want only the kept partition's, moved on", v, n)
		}
	})

	t.Run("a scan reads every item, versions aside", func(t *testing.T) {
		tb := open(t)
		a := item("a", table.Indexes{Time: "2026-10-01"})
		if err := commit(tb, put(a), put(item("b", table.Indexes{}))); err != nil {
			t.Fatal(err)
		}
		all, err := tb.Scan(ctx)
		if err != nil {
			t.Fatal(err)
		}
		// A shared table holds other tests' items too.
		mine := slices.DeleteFunc(all, func(it table.Item) bool { return !strings.HasPrefix(it.PK, pk) })
		slices.SortFunc(mine, func(x, y table.Item) int { return strings.Compare(x.SK, y.SK) })
		if !slices.Equal(keys(mine), []string{"a", "b"}) || mine[0].Time != a.Time {
			t.Fatalf("scan = %+v, want a and b with their index keys", mine)
		}
	})

	t.Run("a delete removes the item from every index", func(t *testing.T) {
		tb := open(t)
		a := item("a", table.Indexes{Time: "2026-10-01"})
		moved, err := tb.Commit(ctx, versions(), table.Versions{thing(): 0}, []table.Write{put(a)})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tb.Commit(ctx, versions(), moved, []table.Write{{Delete: &a.Key}}); err != nil {
			t.Fatal(err)
		}
		got, _ := tb.Query(ctx, table.Query{PK: pk + "THING", Index: table.ByTime})
		if len(got) != 0 {
			t.Fatalf("still listed: %v", keys(got))
		}
	})
}

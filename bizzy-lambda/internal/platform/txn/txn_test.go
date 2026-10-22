package txn_test

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
)

type note struct {
	ID     string    `json:"id"`
	Owner  string    `json:"owner"`
	At     time.Time `json:"at"`
	Pinned bool      `json:"pinned,omitempty"`
}

var notes = txn.Kind[note]{
	Name: "NOTE", Gone: "That note was deleted.",
	Meta: func(n *note) txn.Meta { return txn.Meta{ID: n.ID, Client: n.Owner, Time: n.At, Open: n.Pinned} },
}

var day = time.Date(2026, 10, 13, 0, 0, 0, 0, time.UTC)

func newRunner(invariants ...txn.Invariant) (*txn.Runner, *table.Memory) {
	mem := table.NewMemory()
	ids := 0
	return &txn.Runner{
		Table: mem, Invariants: invariants, Now: func() time.Time { return day }, Location: time.UTC,
		NewID: func() string { ids++; return fmt.Sprintf("n%d", ids) },
	}, mem
}

func ids(ns []*note) []string {
	var out []string
	for _, n := range ns {
		out = append(out, n.ID)
	}
	return out
}

func TestReadsSeeWhatTheActionChanged(t *testing.T) {
	r, _ := newRunner()
	ctx := context.Background()
	_, err := txn.Run(ctx, r, func(tx *txn.Tx) (any, error) {
		for i, owner := range []string{"jane", "bob", "jane"} {
			if err := notes.Add(tx, &note{ID: tx.NewID(), Owner: owner, At: day.Add(time.Duration(i) * time.Hour)}); err != nil {
				return nil, err
			}
		}
		return nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = txn.Run(ctx, r, func(tx *txn.Tx) (any, error) {
		n1, err := notes.Get(tx, "n1")
		if err != nil {
			return nil, err
		}
		n1.Owner = "bob" // changed in place: no save step
		if err := notes.Delete(tx, "n3"); err != nil {
			return nil, err
		}
		jane, err := notes.OfClient(tx, "jane")
		if err != nil || len(jane) != 0 {
			t.Errorf("jane's notes = %v, %v; want none (one moved, one deleted)", ids(jane), err)
		}
		bob, _ := notes.OfClient(tx, "bob")
		if !slices.Equal(ids(bob), []string{"n1", "n2"}) {
			t.Errorf("bob's notes = %v, want n1 n2 in time order", ids(bob))
		}
		if again, _ := notes.Get(tx, "n1"); again != n1 {
			t.Error("reading an item twice gave two copies")
		}
		return nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	all, _ := txn.Read(ctx, r, func(tx *txn.Tx) ([]*note, error) { return notes.All(tx) })
	if !slices.Equal(ids(all), []string{"n1", "n2"}) || all[0].Owner != "bob" {
		t.Errorf("stored = %+v", all)
	}
}

func TestAFailedActionWritesNothing(t *testing.T) {
	r, mem := newRunner()
	before := string(mem.Dump())
	refused := apperr.Refused("no")
	_, err := txn.Run(context.Background(), r, func(tx *txn.Tx) (any, error) {
		_ = notes.Add(tx, &note{ID: "x", At: day})
		return nil, refused
	})
	if !errors.Is(err, refused) || string(mem.Dump()) != before {
		t.Errorf("err = %v; stored changed: %v", err, string(mem.Dump()) != before)
	}
}

func TestABrokenInvariantWritesNothing(t *testing.T) {
	onePinned := txn.Invariant{
		ID: "one-pinned", On: notes.Name,
		Broken: func(tx *txn.Tx, _ string) ([]string, error) {
			open, err := notes.Open(tx)
			if len(open) > 1 {
				return []string{fmt.Sprintf("%d pinned", len(open))}, err
			}
			return nil, err
		},
	}
	r, mem := newRunner(onePinned)
	ctx := context.Background()
	add := func(id string) error {
		_, err := txn.Run(ctx, r, func(tx *txn.Tx) (any, error) {
			return nil, notes.Add(tx, &note{ID: id, At: day, Pinned: true})
		})
		return err
	}
	if err := add("a"); err != nil {
		t.Fatal(err)
	}
	before := string(mem.Dump())
	if err := add("b"); err == nil {
		t.Fatal("a second pinned note was let through")
	}
	if string(mem.Dump()) != before {
		t.Error("the refused commit wrote")
	}
	if broken, err := txn.CheckAll(ctx, r, notes); err != nil || len(broken) != 0 {
		t.Errorf("CheckAll = %v, %v", broken, err)
	}
}

func TestAnotherCommitFirstRerunsTheAction(t *testing.T) {
	r, _ := newRunner()
	ctx := context.Background()
	runs := 0
	got, err := txn.Run(ctx, r, func(tx *txn.Tx) (int, error) {
		runs++
		all, err := notes.All(tx)
		if runs == 1 {
			// Someone else commits between this read and the commit.
			if _, err := txn.Run(ctx, r, func(tx *txn.Tx) (any, error) {
				return nil, notes.Add(tx, &note{ID: "theirs", At: day})
			}); err != nil {
				return 0, err
			}
		}
		return len(all), errors.Join(err, notes.Add(tx, &note{ID: fmt.Sprintf("mine%d", runs), At: day}))
	})
	if err != nil || runs != 2 || got != 1 {
		t.Errorf("runs = %d, saw %d notes, err %v; want a rerun that sees theirs", runs, got, err)
	}
}

// theirs commits a note as someone else would, mid-way through a run.
func theirs(ctx context.Context, r *txn.Runner, id string) error {
	_, err := txn.Run(ctx, r, func(tx *txn.Tx) (any, error) {
		return nil, notes.Add(tx, &note{ID: id, At: day})
	})
	return err
}

func TestARefusalAfterAnotherCommitRerunsTheAction(t *testing.T) {
	r, _ := newRunner()
	ctx := context.Background()
	runs := 0
	_, err := txn.Run(ctx, r, func(tx *txn.Tx) (any, error) {
		runs++
		if runs == 1 {
			// What it read may be half of what was committed meanwhile.
			return nil, errors.Join(theirs(ctx, r, "theirs"), apperr.Refused("no"))
		}
		return nil, nil
	})
	if err != nil || runs != 2 {
		t.Errorf("runs = %d, err %v; want a rerun that isn't refused", runs, err)
	}

	runs = 0
	refused := apperr.Refused("no")
	_, err = txn.Run(ctx, r, func(tx *txn.Tx) (any, error) {
		runs++
		return nil, refused
	})
	if !errors.Is(err, refused) || runs != 1 {
		t.Errorf("runs = %d, err %v; want a refusal on what nothing else changed, run once", runs, err)
	}
}

func TestAReadAfterAnotherCommitRunsAgain(t *testing.T) {
	r, _ := newRunner()
	ctx := context.Background()
	runs := 0
	got, err := txn.Read(ctx, r, func(tx *txn.Tx) (int, error) {
		runs++
		all, err := notes.All(tx)
		if runs == 1 {
			err = errors.Join(err, theirs(ctx, r, "theirs"))
		}
		return len(all), err
	})
	if err != nil || runs != 2 || got != 1 {
		t.Errorf("runs = %d, saw %d notes, err %v; want a rerun that sees theirs", runs, got, err)
	}
}

func TestReadsKeptBusyGiveUp(t *testing.T) {
	r, _ := newRunner()
	ctx := context.Background()
	runs := 0
	_, err := txn.Read(ctx, r, func(tx *txn.Tx) (any, error) {
		runs++
		return nil, theirs(ctx, r, fmt.Sprintf("theirs%d", runs))
	})
	var shown *apperr.Error
	if !errors.As(err, &shown) || shown.Code != apperr.CodeConflict || runs != 5 {
		t.Errorf("runs = %d, err %v; want a conflict after 5", runs, err)
	}
}

func TestReadsMustNotChange(t *testing.T) {
	r, _ := newRunner()
	_, err := txn.Read(context.Background(), r, func(tx *txn.Tx) (any, error) {
		return nil, notes.Add(tx, &note{ID: "x", At: day})
	})
	if err == nil {
		t.Error("a read added a note")
	}
}

func TestEachReadsAListAPageAtATime(t *testing.T) {
	r, _ := newRunner()
	ctx := context.Background()
	// 250 notes, a commit at most holds 99: in batches of 50.
	for batch := range 5 {
		_, err := txn.Run(ctx, r, func(tx *txn.Tx) (any, error) {
			for i := batch * 50; i < (batch+1)*50; i++ {
				owner := "bob"
				if i%2 == 0 {
					owner = "jane"
				}
				if err := notes.Add(tx, &note{ID: fmt.Sprintf("n%03d", i), Owner: owner, At: day.Add(time.Duration(i) * time.Hour)}); err != nil {
					return nil, err
				}
			}
			return nil, nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	// page reads up to n of a list from after, and where it stopped.
	page := func(l txn.List, after string, n int) ([]string, string) {
		var got []string
		next, err := txn.Read(ctx, r, func(tx *txn.Tx) (string, error) {
			return notes.Each(tx, l, after, func(v *note) (bool, error) {
				got = append(got, v.ID)
				return len(got) < n, nil
			})
		})
		if err != nil {
			t.Fatal(err)
		}
		return got, next
	}

	// Pages run past the table's batches, latest first, each once.
	var all []string
	after := ""
	for {
		got, next := page(txn.List{Latest: true}, after, 70)
		all = append(all, got...)
		if after = next; after == "" {
			break
		}
	}
	if len(all) != 250 || all[0] != "n249" || all[249] != "n000" || len(slices.Compact(slices.Clone(all))) != 250 {
		t.Errorf("read %d, from %s to %s; want n249 to n000, each once", len(all), all[0], all[len(all)-1])
	}

	// A client's, between two times; ending on its last item ends the list.
	got, next := page(txn.List{Client: "jane", From: day.Add(10 * time.Hour), To: day.Add(14 * time.Hour)}, "", 3)
	if !slices.Equal(got, []string{"n010", "n012", "n014"}) || next != "" {
		t.Errorf("jane's = %v, next %q; want n010, n012, n014 and no more", got, next)
	}

	// Each is only for reads: a change would see half of it.
	_, err := txn.Run(ctx, r, func(tx *txn.Tx) (string, error) {
		return notes.Each(tx, txn.List{}, "", func(*note) (bool, error) { return true, nil })
	})
	if err == nil {
		t.Error("Each ran in an action")
	}
}

func TestARunnerServesOnlyATableAtItsSchema(t *testing.T) {
	ctx := context.Background()
	for _, s := range []txn.Schema{{Version: 1}, {Version: 0, Migrating: true}} {
		r, mem := newRunner()
		mem.Load(txn.SchemaItem(s))
		read := func() error {
			_, err := txn.Read(ctx, r, func(tx *txn.Tx) ([]*note, error) { return notes.All(tx) })
			return err
		}
		var shown *apperr.Error
		if err := read(); !errors.As(err, &shown) || shown.Code != apperr.CodeUnavailable {
			t.Errorf("table at %+v: err = %v, want the app told it is being updated", s, err)
		}
		r.Migrator = true
		if err := read(); err != nil {
			t.Errorf("table at %+v: the migrator's runner was refused: %v", s, err)
		}
	}
}

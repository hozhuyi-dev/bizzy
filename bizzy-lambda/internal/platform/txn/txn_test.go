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

func TestReadsMustNotChange(t *testing.T) {
	r, _ := newRunner()
	_, err := txn.Read(context.Background(), r, func(tx *txn.Tx) (any, error) {
		return nil, notes.Add(tx, &note{ID: "x", At: day})
	})
	if err == nil {
		t.Error("a read added a note")
	}
}

package txn_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
)

// wholeNotes are notes read whole (txn.Kind.Whole), in a partition of
// their own.
var wholeNotes = txn.Kind[note]{
	Name: "WHOLENOTE", Gone: "gone", Whole: true,
	Meta: func(n *note) txn.Meta { return txn.Meta{ID: n.ID, Client: n.Owner, Time: n.At, Open: n.Pinned} },
}

// TestKeptReadsAreWhatIsStored has two Runners on one table, as two warm
// Lambdas, change it in any order; whatever either reads, from what it
// kept or not, must be what a Runner that kept nothing reads.
func TestKeptReadsAreWhatIsStored(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		ctx := context.Background()
		mem := table.NewMemory()
		newRunner := func() *txn.Runner {
			return &txn.Runner{Table: mem, Now: func() time.Time { return day }, Location: time.UTC, NewID: func() string { return "" }}
		}
		runners := []*txn.Runner{newRunner(), newRunner()}
		kinds := []txn.Kind[note]{notes, wholeNotes}
		owners := []string{"jane", "bob", "amy"}

		// read is everything a run may read of a kind, as text.
		read := func(r *txn.Runner, k txn.Kind[note]) string {
			out, err := txn.Read(ctx, r, func(tx *txn.Tx) (string, error) {
				s := ""
				show := func(ns []*note, err error) error {
					for _, n := range ns {
						s += fmt.Sprintf("%s/%s/%d/%v ", n.ID, n.Owner, n.At.Hour(), n.Pinned)
					}
					s += "| "
					return err
				}
				if err := show(k.All(tx)); err != nil {
					return "", err
				}
				if err := show(k.Open(tx)); err != nil {
					return "", err
				}
				if err := show(k.Between(tx, day.Add(2*time.Hour), day.Add(6*time.Hour))); err != nil {
					return "", err
				}
				for _, o := range owners {
					if err := show(k.OfClient(tx, o)); err != nil {
						return "", err
					}
					has, err := k.HasClient(tx, o)
					if err != nil {
						return "", err
					}
					s += fmt.Sprintf("%s:%v ", o, has)
				}
				for _, id := range []string{"a", "b", "c", "d"} {
					n, ok, err := k.Find(tx, id)
					if err != nil {
						return "", err
					}
					if ok {
						s += fmt.Sprintf("%s=%s ", id, n.Owner)
					}
				}
				// A page at a time, as a list is read.
				after := ""
				for page := 0; page < 10; page++ {
					var got []string
					next, err := k.Each(tx, txn.List{Latest: true}, after, func(n *note) (bool, error) {
						got = append(got, n.ID)
						return len(got) < 2, nil
					})
					if err != nil {
						return "", err
					}
					s += fmt.Sprintf("%v ", got)
					if after = next; after == "" {
						break
					}
				}
				return s, nil
			})
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			return out
		}

		for step := range rapid.IntRange(1, 25).Draw(t, "steps") {
			r := runners[rapid.IntRange(0, 1).Draw(t, "runner")]
			k := kinds[rapid.IntRange(0, 1).Draw(t, "kind")]
			id := rapid.SampledFrom([]string{"a", "b", "c", "d"}).Draw(t, "id")
			switch rapid.IntRange(0, 3).Draw(t, "op") {
			case 0: // read through one of them
				for _, kk := range kinds {
					if got, want := read(r, kk), read(newRunner(), kk); got != want {
						t.Fatalf("step %d, %s:\n kept   %s\n stored %s", step, kk.Name, got, want)
					}
				}
			case 1: // add or change
				n := note{
					ID: id, Owner: rapid.SampledFrom(owners).Draw(t, "owner"),
					At: day.Add(time.Duration(rapid.IntRange(0, 8).Draw(t, "hour")) * time.Hour), Pinned: rapid.Bool().Draw(t, "pinned"),
				}
				if _, err := txn.Run(ctx, r, func(tx *txn.Tx) (any, error) {
					old, ok, err := k.Find(tx, id)
					if err != nil || !ok {
						return nil, k.Add(tx, &n)
					}
					*old = n
					return nil, nil
				}); err != nil {
					t.Fatal(err)
				}
			case 2: // delete
				if _, err := txn.Run(ctx, r, func(tx *txn.Tx) (any, error) { return nil, k.Delete(tx, id) }); err != nil {
					t.Fatal(err)
				}
			case 3: // a read that only warms what it keeps
				read(r, k)
			}
		}
		for _, r := range runners {
			for _, k := range kinds {
				if got, want := read(r, k), read(newRunner(), k); got != want {
					t.Fatalf("at the end, %s:\n kept   %s\n stored %s", k.Name, got, want)
				}
			}
		}
	})
}

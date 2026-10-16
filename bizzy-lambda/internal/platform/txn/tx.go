package txn

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"time"

	"bizzy-lambda/internal/platform/table"
)

// Tx is one run of an action: what it read, and what it changed, which is
// written only when the Runner commits it. Every read goes to the table
// (consistently) and sees what the action changed so far; every item read
// is read once, so changing it in place is changing it (no "save" step).
type Tx struct {
	ctx      context.Context
	table    table.Table
	now      time.Time
	location *time.Location
	newID    func() string
	readOnly bool
	// counter is the commit counter when the transaction began.
	counter int64
	// entries are every item read, added or deleted, by key.
	entries map[table.Key]*entry
	// later are the checks to run once the action is done (see Later).
	later []func() error
}

type entry struct {
	kind  string
	value any // *T of its Kind
	meta  func() Meta
	// original is the item as read, and was its Meta then; nil and zero
	// when added in this transaction.
	original []byte
	was      Meta
	deleted  bool
}

// Context is the request's.
func (tx *Tx) Context() context.Context { return tx.ctx }

// Now is the time of the action, the same throughout it.
func (tx *Tx) Now() time.Time { return tx.now }

// Location is the user's time zone, for days and times shown.
func (tx *Tx) Location() *time.Location { return tx.location }

// NewID is a new item id.
func (tx *Tx) NewID() string { return tx.newID() }

// Later runs a check once the action has made all its changes, instead of
// now: for a rule about how a change sits among other items (no two
// sessions overlap), so that changes made in one action are judged
// together. Two sessions swapped in one action each move onto the other's
// time; checked as each moves, both would be refused. A refusal is a
// LateError.
func (tx *Tx) Later(check func() error) { tx.later = append(tx.later, check) }

// LateError is a refusal by a check run Later. It unwraps to the refusal.
type LateError struct{ Err error }

func (e *LateError) Error() string { return e.Err.Error() }
func (e *LateError) Unwrap() error { return e.Err }

var errReadOnly = errors.New("txn: a read changed something")

func (tx *Tx) writable() error {
	if tx.readOnly {
		return errReadOnly
	}
	return nil
}

// Change is one item a commit wrote.
type Change struct {
	Kind    string
	ID      string
	Added   bool
	Deleted bool
	// Ref is what the item refers to (Meta.Ref) as the commit left it, or
	// as it was when deleted; WasRef as it was read. A change of what an
	// item refers to touches both.
	Ref    string
	WasRef string
}

// changes are what the transaction writes: each item added, deleted, or
// changed since it was read, in key order.
func (tx *Tx) changes() ([]Change, []table.Write, error) {
	var changes []Change
	var writes []table.Write
	for _, key := range slices.SortedFunc(maps.Keys(tx.entries), compareKeys) {
		e := tx.entries[key]
		switch {
		case e.deleted && e.original == nil:
			continue
		case e.deleted:
			changes = append(changes, Change{Kind: e.kind, ID: key.SK, Deleted: true, Ref: e.meta().Ref, WasRef: e.was.Ref})
			writes = append(writes, table.Write{Delete: &key})
			continue
		}
		data, err := json.Marshal(e.value)
		if err != nil {
			return nil, nil, fmt.Errorf("txn: encode %s %s: %w", key.PK, key.SK, err)
		}
		if e.original != nil && bytes.Equal(data, e.original) {
			continue
		}
		m := e.meta()
		if m.ID != key.SK {
			return nil, nil, fmt.Errorf("txn: %s %s changed its id to %q", key.PK, key.SK, m.ID)
		}
		changes = append(changes, Change{Kind: e.kind, ID: key.SK, Added: e.original == nil, Ref: m.Ref, WasRef: e.was.Ref})
		writes = append(writes, table.Write{Put: &table.Item{Key: key, Indexes: m.indexes(), Data: data}})
	}
	return changes, writes, nil
}

func compareKeys(a, b table.Key) int {
	return cmp.Or(cmp.Compare(a.PK, b.PK), cmp.Compare(a.SK, b.SK))
}

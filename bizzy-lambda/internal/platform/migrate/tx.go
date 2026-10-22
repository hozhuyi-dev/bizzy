package migrate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
)

// Tx is how a migration reads and writes items: as stored, by partition
// (the kind's Name) and id, with their fields as JSON.
//
// Writes are committed a batch at a time (table.MaxWrites) as they fill,
// with no index keys: Run rewrites every item once the migrations are
// done, so a migration reads only by partition and id. Reads see what is
// stored, which may not yet hold what the migration wrote: read an item
// before writing it.
type Tx struct {
	ctx     context.Context
	table   table.Table
	pending []table.Write
	written int
}

// pageSize is how many items Each reads at a time.
const pageSize = 100

func (m *Tx) Context() context.Context { return m.ctx }

// Each hands every stored item of a partition to do, in id order.
func (m *Tx) Each(pk string, do func(id string, data []byte) error) error {
	q := table.Query{PK: pk, Limit: pageSize}
	for {
		items, err := m.table.Query(m.ctx, q)
		if err != nil {
			return err
		}
		for _, it := range items {
			if err := do(it.SK, it.Data); err != nil {
				return fmt.Errorf("%s %s: %w", pk, it.SK, err)
			}
		}
		if len(items) < q.Limit {
			return nil
		}
		last := table.PlaceOf(table.ByID, items[len(items)-1])
		q.After = &last
	}
}

// Get reads one stored item.
func (m *Tx) Get(pk, id string) ([]byte, bool, error) {
	it, ok, err := m.table.Get(m.ctx, table.Key{PK: pk, SK: id})
	return it.Data, ok, err
}

// Put stores an item, replacing any with its id; data is its fields as a
// JSON object.
func (m *Tx) Put(pk, id string, data []byte) error {
	if !json.Valid(data) {
		return fmt.Errorf("migrate: %s %s: not JSON: %s", pk, id, data)
	}
	return m.write(table.Write{Put: &table.Item{Key: table.Key{PK: pk, SK: id}, Data: data}})
}

// Delete removes an item, if it exists.
func (m *Tx) Delete(pk, id string) error {
	return m.write(table.Write{Delete: &table.Key{PK: pk, SK: id}})
}

// write adds a write to the batch, committing the batch first when it is
// full or already writes the same item (a transaction can't write one
// twice).
func (m *Tx) write(w table.Write) error {
	key := keyOf(w)
	if len(m.pending) == table.MaxWrites || slices.ContainsFunc(m.pending, func(p table.Write) bool { return keyOf(p) == key }) {
		if err := m.flush(); err != nil {
			return err
		}
	}
	m.pending = append(m.pending, w)
	return nil
}

// flush commits the batch.
func (m *Tx) flush() error {
	if len(m.pending) == 0 {
		return nil
	}
	if err := commit(m.ctx, m.table, m.pending); err != nil {
		return err
	}
	m.written += len(m.pending)
	m.pending = nil
	return nil
}

func keyOf(w table.Write) table.Key {
	if w.Put != nil {
		return w.Put.Key
	}
	return *w.Delete
}

// rewrite writes items as review rewrote them.
func rewrite(ctx context.Context, tb table.Table, items []table.Item) (int, error) {
	m := &Tx{ctx: ctx, table: tb}
	for _, it := range items {
		if err := m.write(table.Write{Put: &it}); err != nil {
			return m.written, err
		}
	}
	return m.written, m.flush()
}

// setSchema records how far the table is migrated.
func setSchema(ctx context.Context, tb table.Table, s txn.Schema) error {
	it := txn.SchemaItem(s)
	return commit(ctx, tb, []table.Write{{Put: &it}})
}

// commitAttempts bounds the retries of a commit another one went before:
// a request finishing as the fence goes up. Once it is up, only another
// migration could, and deploys of one environment never overlap.
const commitAttempts = 3

// commit writes a batch, moving the commit counter as every commit does,
// so that runs which began before it fail and rerun (against the fence).
func commit(ctx context.Context, tb table.Table, writes []table.Write) error {
	for range commitAttempts {
		n, err := tb.Counter(ctx, txn.Commits)
		if err != nil {
			return err
		}
		if err := tb.Commit(ctx, txn.Commits, n, writes); !errors.Is(err, table.ErrConflict) {
			return err
		}
	}
	return errors.New("migrate: other commits kept going first: is another migration running?")
}

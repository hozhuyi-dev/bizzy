package table

import (
	"cmp"
	"context"
	"encoding/json"
	"maps"
	"slices"
	"sync"
)

// Memory is a Table in memory, for tests and the simulation. It behaves
// as the DynamoDB one does: the contract test (table_test.go) runs against
// both.
type Memory struct {
	mu       sync.Mutex
	items    map[Key]Item
	counters map[Key]int64
	// BeforeCommit, when set, runs before each commit is applied; the
	// simulation panics in it to crash a request halfway.
	BeforeCommit func()
}

func NewMemory() *Memory {
	return &Memory{items: map[Key]Item{}, counters: map[Key]int64{}}
}

func (m *Memory) Get(_ context.Context, key Key) (Item, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	it, ok := m.items[key]
	return it, ok, nil
}

func (m *Memory) Query(_ context.Context, q Query) ([]Item, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Item{}
	for _, it := range m.items {
		if q.Matches(it) {
			out = append(out, it)
		}
	}
	order := func(a, b Place) int {
		c := cmp.Or(cmp.Compare(a.SortKey, b.SortKey), cmp.Compare(a.SK, b.SK))
		if q.Desc {
			return -c
		}
		return c
	}
	slices.SortFunc(out, func(a, b Item) int { return order(PlaceOf(q.Index, a), PlaceOf(q.Index, b)) })
	if q.After != nil {
		out = slices.DeleteFunc(out, func(it Item) bool { return order(PlaceOf(q.Index, it), *q.After) <= 0 })
	}
	if q.Limit > 0 && len(out) > q.Limit {
		out = out[:q.Limit]
	}
	return out, nil
}

func (m *Memory) Counter(_ context.Context, key Key) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.counters[key], nil
}

func (m *Memory) Commit(_ context.Context, counter Key, from int64, writes []Write) error {
	if len(writes) > MaxWrites {
		return ErrTooBig
	}
	if m.BeforeCommit != nil {
		m.BeforeCommit()
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.counters[counter] != from {
		return ErrConflict
	}
	m.counters[counter] = from + 1
	for _, w := range writes {
		switch {
		case w.Put != nil:
			m.items[w.Put.Key] = *w.Put
		case w.Delete != nil:
			delete(m.items, *w.Delete)
		}
	}
	return nil
}

func (m *Memory) Wipe(_ context.Context, keep ...string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	deleted := 0
	for key, it := range m.items {
		if !slices.Contains(keep, key.PK) || len(it.Data) == 0 {
			delete(m.items, key)
			deleted++
		}
	}
	for key := range m.counters {
		if !slices.Contains(keep, key.PK) {
			delete(m.counters, key)
			deleted++
		}
	}
	return deleted, nil
}

// Dump is everything stored, as JSON in a stable order: two dumps are
// equal when nothing changed.
func (m *Memory) Dump() []byte {
	m.mu.Lock()
	defer m.mu.Unlock()
	type row struct {
		Key     Key             `json:"key"`
		Indexes Indexes         `json:"indexes"`
		Data    json.RawMessage `json:"data"`
	}
	var rows []row
	for _, key := range slices.SortedFunc(maps.Keys(m.items), compareKeys) {
		it := m.items[key]
		rows = append(rows, row{key, it.Indexes, it.Data})
	}
	out, _ := json.Marshal(rows)
	return out
}

// Clone is a copy of everything stored, for a check that must not touch
// the original.
func (m *Memory) Clone() *Memory {
	m.mu.Lock()
	defer m.mu.Unlock()
	return &Memory{items: maps.Clone(m.items), counters: maps.Clone(m.counters)}
}

func compareKeys(a, b Key) int {
	return cmp.Or(cmp.Compare(a.PK, b.PK), cmp.Compare(a.SK, b.SK))
}

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
	versions map[Key]Versions
	// BeforeCommit, when set, runs before each commit is applied; the
	// simulation panics in it to crash a request halfway.
	BeforeCommit func()
}

func NewMemory() *Memory {
	return &Memory{items: map[Key]Item{}, versions: map[Key]Versions{}}
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
	return Select(slices.Collect(maps.Values(m.items)), q), nil
}

func (m *Memory) Scan(context.Context) ([]Item, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Collect(maps.Values(m.items)), nil
}

// Load stores items as they are, outside any commit: a copy of another
// table (see Scan).
func (m *Memory) Load(items ...Item) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, it := range items {
		m.items[it.Key] = it
	}
}

func (m *Memory) Versions(_ context.Context, key Key) (Versions, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v := Versions{}
	maps.Copy(v, m.versions[key])
	return v, nil
}

func (m *Memory) Commit(_ context.Context, key Key, read Versions, writes []Write) (Versions, error) {
	if len(writes) > MaxWrites {
		return nil, ErrTooBig
	}
	next, err := Moved(read, writes)
	if err != nil {
		return nil, err
	}
	if m.BeforeCommit != nil {
		m.BeforeCommit()
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.versions[key]
	for pk, v := range read {
		if now[pk] != v {
			return nil, ErrConflict
		}
	}
	if now == nil {
		now = Versions{}
		m.versions[key] = now
	}
	maps.Copy(now, next)
	for _, w := range writes {
		switch {
		case w.Put != nil:
			m.items[w.Put.Key] = *w.Put
		case w.Delete != nil:
			delete(m.items, *w.Delete)
		}
	}
	return next, nil
}

func (m *Memory) Wipe(_ context.Context, key Key, keep ...string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	deleted := 0
	for k, it := range m.items {
		if !slices.Contains(keep, k.PK) || len(it.Data) == 0 {
			delete(m.items, k)
			deleted++
		}
	}
	for k := range m.versions {
		if !slices.Contains(keep, k.PK) {
			delete(m.versions, k)
			deleted++
		}
	}
	fresh := Versions{}
	for _, pk := range keep {
		fresh[pk] = Next(0)
	}
	m.versions[key] = fresh
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
	versions := map[Key]Versions{}
	for k, v := range m.versions {
		versions[k] = maps.Clone(v)
	}
	return &Memory{items: maps.Clone(m.items), versions: versions}
}

func compareKeys(a, b Key) int {
	return cmp.Or(cmp.Compare(a.PK, b.PK), cmp.Compare(a.SK, b.SK))
}

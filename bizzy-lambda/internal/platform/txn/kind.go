package txn

import (
	"bytes"
	"cmp"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/table"
)

// Kind is one kind of stored item (clients, sessions, …): where its items
// live, and how each is filed in the indexes. A feature declares one per
// entity and reads and writes its items only through it.
type Kind[T any] struct {
	// Name is the partition its items live in, e.g. "SESSION".
	Name string
	// Gone is what the app shows when one is asked for and doesn't exist.
	Gone string
	// Meta files an item. It must read the item alone, nothing else.
	Meta func(*T) Meta
	// Doc says what the kind is, and what each index it files items in
	// means for it: the schema (see SCHEMA.md).
	Doc Doc
}

// Doc describes a kind for the schema: what one item is, and what each
// index means for it ("" for one it doesn't use).
type Doc struct {
	What                         string
	Client, Time, Open, Tag, Ref string
}

// Field is one stored field of a kind's items: its JSON name and Go type.
type Field struct {
	Name, Type string
}

// KindDoc is the kind's Doc.
func (k Kind[T]) KindDoc() Doc { return k.Doc }

// Fields are the stored fields of the kind's items, in order.
func (k Kind[T]) Fields() []Field {
	var out []Field
	t := reflect.TypeFor[T]()
	for i := range t.NumField() {
		f := t.Field(i)
		name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		if !f.IsExported() || name == "-" {
			continue
		}
		if name == "" {
			name = f.Name
		}
		out = append(out, Field{Name: name, Type: f.Type.String()})
	}
	return out
}

// Meta is how an item is filed: its id, and where it is listed.
type Meta struct {
	ID string
	// Client is the client it belongs to: listed by OfClient.
	Client string
	// Time is its main time: listed by Between, and the order of the other
	// lists.
	Time time.Time
	// Open puts it on the to-do list: listed by Open.
	Open bool
	// Tag lists it by Tagged.
	Tag string
	// Ref is what it refers to outside bizzy, e.g. the calendar event that
	// shows it: listed by WithRef.
	Ref string
}

// TimeKey writes a time for an index: UTC, so the keys sort in time order.
func TimeKey(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func (m Meta) indexes() table.Indexes {
	at := ""
	if !m.Time.IsZero() {
		at = TimeKey(m.Time)
	}
	ix := table.Indexes{Time: at, Ref: m.Ref}
	if m.Client != "" {
		ix.Client = m.Client + "#" + at
	}
	if m.Open {
		ix.Open = cmp.Or(at, "-")
	}
	if m.Tag != "" {
		ix.Tag = m.Tag + "#" + at
	}
	return ix
}

// Find reads an item; false when there is none.
func (k Kind[T]) Find(tx *Tx, id string) (*T, bool, error) {
	key := table.Key{PK: k.Name, SK: id}
	if e, ok := tx.entries[key]; ok {
		if e.deleted {
			return nil, false, nil
		}
		return e.value.(*T), true, nil
	}
	it, ok, err := tx.table.Get(tx.ctx, key)
	if err != nil || !ok {
		return nil, false, err
	}
	v, err := k.cache(tx, it)
	return v, err == nil, err
}

// Get reads an item, or returns the error the app shows when it's gone.
func (k Kind[T]) Get(tx *Tx, id string) (*T, error) {
	v, ok, err := k.Find(tx, id)
	if err == nil && !ok {
		err = apperr.NotFound("%s", k.Gone)
	}
	return v, err
}

// All lists every item, by id.
func (k Kind[T]) All(tx *Tx) ([]*T, error) {
	return k.query(tx, table.Query{PK: k.Name})
}

// OfClient lists a client's items, by time.
func (k Kind[T]) OfClient(tx *Tx, clientID string) ([]*T, error) {
	return k.query(tx, table.Query{PK: k.Name, Index: table.ByClient, Prefix: clientID + "#"})
}

// HasClient reports whether a client has any item of this kind.
func (k Kind[T]) HasClient(tx *Tx, clientID string) (bool, error) {
	items, err := k.OfClient(tx, clientID)
	return len(items) > 0, err
}

// Between lists the items whose time is in [from, to], by time.
func (k Kind[T]) Between(tx *Tx, from, to time.Time) ([]*T, error) {
	return k.query(tx, table.Query{PK: k.Name, Index: table.ByTime, From: TimeKey(from), To: TimeKey(to)})
}

// Open lists the items on the to-do list, by time.
func (k Kind[T]) Open(tx *Tx) ([]*T, error) {
	return k.query(tx, table.Query{PK: k.Name, Index: table.ByOpen})
}

// Tagged lists the items with a tag, by time.
func (k Kind[T]) Tagged(tx *Tx, tag string) ([]*T, error) {
	return k.query(tx, table.Query{PK: k.Name, Index: table.ByTag, Prefix: tag + "#"})
}

// TaggedBetween lists the items with a tag whose time is in [from, to],
// by time.
func (k Kind[T]) TaggedBetween(tx *Tx, tag string, from, to time.Time) ([]*T, error) {
	return k.query(tx, table.Query{PK: k.Name, Index: table.ByTag, From: tag + "#" + TimeKey(from), To: tag + "#" + TimeKey(to)})
}

// WithRef lists the items that refer to ref.
func (k Kind[T]) WithRef(tx *Tx, ref string) ([]*T, error) {
	return k.query(tx, table.Query{PK: k.Name, Index: table.ByRef, Equals: ref})
}

// List is one of a kind's lists in time order, for reading a page at a
// time (Each): all its items, a client's, those with a tag, or the open
// ones, between two times (a zero one leaves that end open).
type List struct {
	Client   string
	Tag      string
	Open     bool
	From, To time.Time
	// Latest lists the latest first.
	Latest bool
}

// listQuery is the list as a table query.
func (k Kind[T]) listQuery(l List) table.Query {
	q := table.Query{PK: k.Name, Index: table.ByTime, Desc: l.Latest}
	prefix := ""
	switch {
	case l.Client != "":
		q.Index, prefix = table.ByClient, l.Client+"#"
	case l.Tag != "":
		q.Index, prefix = table.ByTag, l.Tag+"#"
	case l.Open:
		q.Index = table.ByOpen
	}
	if prefix != "" {
		// Times are digits and punctuation, all before "~".
		q.From, q.To = prefix, prefix+"~"
	}
	if !l.From.IsZero() {
		q.From = prefix + TimeKey(l.From)
	}
	if !l.To.IsZero() {
		q.To = prefix + TimeKey(l.To)
	}
	return q
}

// eachBatch is how many items Each reads from the table at a time.
const eachBatch = 100

// Each reads a list a batch at a time and hands each item to do, until do
// returns false or the list runs out. It returns where it stopped, for
// reading on from (after) later: "" when the list ran out. It reads what
// is stored, not what the transaction changed, so it is only for a Read.
func (k Kind[T]) Each(tx *Tx, l List, after string, do func(*T) (bool, error)) (string, error) {
	if !tx.readOnly {
		return "", errors.New("txn: Each reads what is stored: only in a Read")
	}
	q := k.listQuery(l)
	q.Limit = eachBatch
	if after != "" {
		place, err := parsePlace(after)
		if err != nil {
			return "", err
		}
		q.After = &place
	}
	for {
		items, err := tx.table.Query(tx.ctx, q)
		if err != nil {
			return "", err
		}
		for i, it := range items {
			v, err := k.cache(tx, it)
			if err != nil {
				return "", err
			}
			more, err := do(v)
			switch {
			case err != nil:
				return "", err
			case more:
				continue
			case i == len(items)-1 && len(items) < q.Limit:
				return "", nil
			}
			return formatPlace(table.PlaceOf(q.Index, it)), nil
		}
		if len(items) < q.Limit {
			return "", nil
		}
		last := table.PlaceOf(q.Index, items[len(items)-1])
		q.After = &last
	}
}

// formatPlace writes a place in a list for the app to send back.
func formatPlace(p table.Place) string {
	return base64.RawURLEncoding.EncodeToString([]byte(p.SortKey + "\n" + p.SK))
}

func parsePlace(s string) (table.Place, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	sortKey, sk, ok := strings.Cut(string(raw), "\n")
	if err != nil || !ok {
		return table.Place{}, apperr.Invalid("This list moved on; start it again.")
	}
	return table.Place{SortKey: sortKey, SK: sk}, nil
}

// Add stores a new item.
func (k Kind[T]) Add(tx *Tx, v *T) error {
	if err := tx.writable(); err != nil {
		return err
	}
	id := k.Meta(v).ID
	if id == "" {
		return fmt.Errorf("txn: %s added without an id", k.Name)
	}
	key := table.Key{PK: k.Name, SK: id}
	var original []byte
	var was Meta
	if e, ok := tx.entries[key]; ok {
		if !e.deleted {
			return fmt.Errorf("txn: %s %s added twice", k.Name, id)
		}
		original, was = e.original, e.was
	}
	e := k.entry(v, original)
	e.was = was
	tx.entries[key] = e
	return nil
}

// Delete removes an item, if it exists.
func (k Kind[T]) Delete(tx *Tx, id string) error {
	if err := tx.writable(); err != nil {
		return err
	}
	if _, ok, err := k.Find(tx, id); err != nil || !ok {
		return err
	}
	tx.entries[table.Key{PK: k.Name, SK: id}].deleted = true
	return nil
}

// IDs lists the id of every item, for checking every one (see CheckAll).
func (k Kind[T]) IDs(tx *Tx) ([]string, error) {
	all, err := k.All(tx)
	var ids []string
	for _, v := range all {
		ids = append(ids, k.Meta(v).ID)
	}
	return ids, err
}

// KindName is the partition, which names the kind in Changes and
// Invariants.
func (k Kind[T]) KindName() string { return k.Name }

// Rewrite is a stored item as this code would write it: decoded strictly
// as T (a field T doesn't have is an error), encoded again, and filed by
// Meta. Reads expect exactly that (see Tx.changes), so after a change to
// T or Meta every item is rewritten: migrations write items as JSON, and
// platform/migrate rewrites them all with this once they have run.
func (k Kind[T]) Rewrite(it table.Item) (table.Item, error) {
	v := new(T)
	dec := json.NewDecoder(bytes.NewReader(it.Data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return it, fmt.Errorf("%s %s doesn't read as the code reads it: %w", it.PK, it.SK, err)
	}
	m := k.Meta(v)
	if m.ID != it.SK {
		return it, fmt.Errorf("%s %s says its id is %q", it.PK, it.SK, m.ID)
	}
	data, err := json.Marshal(v)
	it.Data, it.Indexes = data, m.indexes()
	return it, err
}

func (k Kind[T]) entry(v *T, original []byte) *entry {
	return &entry{kind: k.Name, value: v, original: original, meta: func() Meta { return k.Meta(v) }}
}

// cache keeps an item read from the table, unless the transaction already
// has it: what the transaction did to it wins.
func (k Kind[T]) cache(tx *Tx, it table.Item) (*T, error) {
	if e, ok := tx.entries[it.Key]; ok {
		return e.value.(*T), nil
	}
	v := new(T)
	if err := json.Unmarshal(it.Data, v); err != nil {
		return nil, fmt.Errorf("txn: decode %s %s: %w", it.PK, it.SK, err)
	}
	e := k.entry(v, it.Data)
	e.was = k.Meta(v)
	tx.entries[it.Key] = e
	return v, nil
}

// query reads what a query matches, as the transaction leaves it: items it
// added or changed to match are in, those it deleted or changed not to are
// out.
func (k Kind[T]) query(tx *Tx, q table.Query) ([]*T, error) {
	items, err := tx.table.Query(tx.ctx, q)
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		if _, err := k.cache(tx, it); err != nil {
			return nil, err
		}
	}
	type hit struct {
		sort, id string
		v        *T
	}
	var hits []hit
	for key, e := range tx.entries {
		if e.kind != k.Name || e.deleted {
			continue
		}
		it := table.Item{Key: key, Indexes: e.meta().indexes()}
		if q.Matches(it) {
			hits = append(hits, hit{it.SortKey(q.Index), key.SK, e.value.(*T)})
		}
	}
	slices.SortFunc(hits, func(a, b hit) int { return cmp.Or(cmp.Compare(a.sort, b.sort), cmp.Compare(a.id, b.id)) })
	out := make([]*T, len(hits))
	for i, h := range hits {
		out[i] = h.v
	}
	return out, nil
}

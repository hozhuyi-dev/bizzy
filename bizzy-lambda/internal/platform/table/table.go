// Package table is the storage bizzy runs on: one DynamoDB table in
// production (platform/dynamo), an in-memory one in tests (Memory). Both
// implement Table, and everything above it (platform/txn) is shared, so the
// simulation exercises the same logic production runs.
//
// The layout:
//   - One partition per kind of item (PK = "CLIENT", "SESSION", …); SK is
//     the item's id. One user means little data, and a partition holds
//     decades of a one-person practice.
//   - Five local secondary indexes give other orders within a partition,
//     each with one meaning for every kind (see Index). Each is sparse: an
//     item without a sort key for an index is not in it.
//   - An item's fields are stored as JSON in one attribute, so what is read
//     back is exactly what was written, in DynamoDB and in memory alike.
//   - One item holds every partition's version, which each commit that
//     writes a partition moves on (see Commit): a commit goes through only
//     if what it read hasn't moved since (see platform/txn).
package table

import (
	"cmp"
	"context"
	"errors"
	"slices"
	"strings"
	"time"
)

// Key identifies an item: its partition (its kind) and its id.
type Key struct {
	PK string `json:"pk"`
	SK string `json:"sk"`
}

// Index names one of the table's local secondary indexes, or the table's
// own sort key (ByID).
type Index string

const (
	ByID Index = ""
	// ByTime orders items by their main time: "<time>".
	ByTime Index = "LSI1"
	// ByClient groups a client's items: "<clientId>#<time>".
	ByClient Index = "LSI2"
	// ByOpen holds only items on the to-do list: "<time>".
	ByOpen Index = "LSI3"
	// ByTag groups items by a tag: "<tag>#<time>".
	ByTag Index = "LSI4"
	// ByRef finds items by what they refer to outside: "<ref>".
	ByRef Index = "LSI5"
)

// Indexes are the item's sort key in each index; "" leaves it out.
type Indexes struct {
	Time   string `json:"time,omitempty"`
	Client string `json:"client,omitempty"`
	Open   string `json:"open,omitempty"`
	Tag    string `json:"tag,omitempty"`
	Ref    string `json:"ref,omitempty"`
}

// Of is the item's sort key in an index ("" for ByID: see Item.SortKey).
func (ix Indexes) Of(i Index) string {
	switch i {
	case ByTime:
		return ix.Time
	case ByClient:
		return ix.Client
	case ByOpen:
		return ix.Open
	case ByTag:
		return ix.Tag
	case ByRef:
		return ix.Ref
	}
	return ""
}

// Item is one stored item.
type Item struct {
	Key
	Indexes
	// Data is the item's fields, as JSON.
	Data []byte
}

// SortKey is the item's sort key in an index.
func (it Item) SortKey(i Index) string {
	if i == ByID {
		return it.SK
	}
	return it.Indexes.Of(i)
}

// Query reads one partition in the order of an index. With no bound it
// reads the whole index; Equals, Prefix or From/To bound it.
type Query struct {
	PK    string
	Index Index
	// Equals, Prefix, or the inclusive range From–To (either may be "").
	Equals   string
	Prefix   string
	From, To string
	// Desc reads it backwards: latest first, in an index by time.
	Desc bool
	// After starts the read just past a place in the order (the last item
	// of the read before), and Limit stops it after that many items (0
	// reads to the end): a long list read a page at a time.
	After *Place
	Limit int
}

// Place is an item's place in an index's order: its sort key there, and
// its id.
type Place struct {
	SortKey, SK string
}

// PlaceOf is an item's place in an index.
func PlaceOf(i Index, it Item) Place { return Place{SortKey: it.SortKey(i), SK: it.SK} }

// Matches reports whether an item is in the query's result, Limit and
// After aside.
func (q Query) Matches(it Item) bool {
	if it.PK != q.PK {
		return false
	}
	v := it.SortKey(q.Index)
	switch {
	case v == "":
		return false
	case q.Equals != "":
		return v == q.Equals
	case q.Prefix != "":
		return strings.HasPrefix(v, q.Prefix)
	}
	return (q.From == "" || v >= q.From) && (q.To == "" || v <= q.To)
}

// Select is what a query reads from a partition's items, as a table
// would: those it matches, in its order, from After, up to Limit.
func Select(items []Item, q Query) []Item {
	out := []Item{}
	for _, it := range items {
		if q.Matches(it) && q.Past(it) {
			out = append(out, it)
		}
	}
	slices.SortFunc(out, func(a, b Item) int { return q.Order(PlaceOf(q.Index, a), PlaceOf(q.Index, b)) })
	if q.Limit > 0 && len(out) > q.Limit {
		out = out[:q.Limit]
	}
	return out
}

// Order compares two places in the query's order.
func (q Query) Order(a, b Place) int {
	c := cmp.Or(cmp.Compare(a.SortKey, b.SortKey), cmp.Compare(a.SK, b.SK))
	if q.Desc {
		return -c
	}
	return c
}

// Past reports whether an item comes after the query's After, if it has
// one.
func (q Query) Past(it Item) bool {
	return q.After == nil || q.Order(PlaceOf(q.Index, it), *q.After) > 0
}

// Write is one change of a commit: Put replaces an item, Delete removes one.
type Write struct {
	Put    *Item
	Delete *Key
}

// PK is the partition the write is in.
func (w Write) PK() string {
	if w.Put != nil {
		return w.Put.PK
	}
	return w.Delete.PK
}

// MaxWrites is how many writes one commit takes: DynamoDB's 100 per
// transaction, less the versions.
const MaxWrites = 99

// Versions are partitions' versions: each moves on with every commit that
// writes the partition. 0 is a partition never written (or wiped since).
// What a partition holds is the same whenever its version is: what was
// read of it at one version is still true while it is at that version.
type Versions map[string]int64

// Next is the version a commit moves a partition on to from v. From 0 it
// starts at the time, so a partition wiped and written again never comes
// back to a version it had before.
func Next(v int64) int64 {
	if v == 0 {
		return time.Now().UnixNano()
	}
	return v + 1
}

// ErrConflict means a partition the commit read moved since: another
// commit went first. Nothing was written.
var ErrConflict = errors.New("table: another commit went first")

// ErrTooBig is a commit of more than MaxWrites writes.
var ErrTooBig = errors.New("table: too many writes for one commit")

type Table interface {
	// Get reads one item, consistently.
	Get(ctx context.Context, key Key) (Item, bool, error)
	// Query reads the items a query matches, consistently, in index order
	// (items with the same sort key in a fixed order of their own).
	Query(ctx context.Context, q Query) ([]Item, error)
	// Scan reads every item, in no order (versions aside): for copying the
	// table, as a migration's dry run does (see platform/migrate).
	Scan(ctx context.Context) ([]Item, error)
	// Versions reads the partitions' versions, kept in one item, at once.
	Versions(ctx context.Context, key Key) (Versions, error)
	// Commit applies the writes, all or none, if every partition in read
	// is still at its version there; it moves each partition written on
	// (Next) and returns their new versions. ErrConflict if one moved.
	// Every partition written must be in read.
	Commit(ctx context.Context, key Key, read Versions, writes []Write) (Versions, error)
	// Wipe deletes every item and version outside the kept partitions, and
	// any item inside them that isn't one (written by an older version of
	// bizzy, so unreadable); it returns how many it deleted. The kept
	// partitions move on to new versions (in the versions item at key), so
	// a partition at 0 is always an empty one. Only for starting a test
	// environment over (see features/reset).
	Wipe(ctx context.Context, key Key, keep ...string) (int, error)
}

// Moved are the versions a commit moves its writes' partitions on to, or
// an error when one isn't in read.
func Moved(read Versions, writes []Write) (Versions, error) {
	next := Versions{}
	for _, w := range writes {
		pk := w.PK()
		v, ok := read[pk]
		if !ok {
			return nil, errors.New("table: a commit writes " + pk + " without its version")
		}
		next[pk] = Next(v)
	}
	return next, nil
}

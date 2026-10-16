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
//   - Every commit moves one counter on (see Commit), which makes commits
//     happen one at a time (see platform/txn).
package table

import (
	"context"
	"errors"
	"strings"
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
}

// Matches reports whether an item is in the query's result.
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

// Write is one change of a commit: Put replaces an item, Delete removes one.
type Write struct {
	Put    *Item
	Delete *Key
}

// MaxWrites is how many writes one commit takes: DynamoDB's 100 per
// transaction, less the counter.
const MaxWrites = 99

// ErrConflict means the counter moved since it was read: another commit
// went first. Nothing was written.
var ErrConflict = errors.New("table: another commit went first")

// ErrTooBig is a commit of more than MaxWrites writes.
var ErrTooBig = errors.New("table: too many writes for one commit")

type Table interface {
	// Get reads one item, consistently.
	Get(ctx context.Context, key Key) (Item, bool, error)
	// Query reads the items a query matches, consistently, in index order.
	Query(ctx context.Context, q Query) ([]Item, error)
	// Counter reads a counter's value; 0 before it was ever moved.
	Counter(ctx context.Context, key Key) (int64, error)
	// Commit moves a counter from `from` to from+1 and applies the writes,
	// all or none: ErrConflict if the counter isn't at `from`.
	Commit(ctx context.Context, counter Key, from int64, writes []Write) error
	// Wipe deletes every item and counter outside the kept partitions, and
	// any item inside them that isn't one (written by an older version of
	// bizzy, so unreadable); it returns how many it deleted. Only for
	// starting a test environment over (see features/reset).
	Wipe(ctx context.Context, keep ...string) (int, error)
}

// Package listing is how the app's long lists are searched: a page at a
// time, filtered here after an index has narrowed the read (to a stretch
// of time, a client, a tag) as far as it can.
//
// DynamoDB narrows a read only by an index's keys. A filter on anything
// else still reads, and bills, every item it looks at, and can't see what
// a view works out (what is left to do on a session), so filters run here
// instead. A page ends when it is full or has looked at Budget items, so a
// search for something rare still answers soon; Next looks further.
package listing

import (
	"slices"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// Request is what every search route takes, besides its own filters.
type Request struct {
	// Text is words to find: each must be in one of an item's fields, in
	// any case, accents aside.
	Text string `json:"text"`
	// From and To are days, YYYY-MM-DD, both included; "" leaves that end
	// open.
	From string `json:"from"`
	To   string `json:"to"`
	// After is where the page starts: the Next of the page before.
	After string `json:"after"`
	// Limit is the most items a page holds: DefaultLimit unless set,
	// MaxLimit at most.
	Limit int `json:"limit"`
}

// Page is a page of a list.
type Page[V any] struct {
	Items []V `json:"items"`
	// Next reads the page after this one; "" on the last.
	Next string `json:"next,omitempty"`
}

const (
	DefaultLimit = 50
	MaxLimit     = 200
	// Budget is how many items a page looks at, matching or not.
	Budget = 500
)

// Span is the request's days as times in loc: the start of From and the
// last second of To, zero for an open end. Days stored as dates (documents,
// expenses) are UTC; times (sessions) are the user's (tx.Location()).
func (r Request) Span(loc *time.Location) (from, to time.Time, err error) {
	invalid := apperr.Invalid("Days are written like 2026-10-31, the first one first.")
	if r.From != "" {
		if from, err = time.ParseInLocation(time.DateOnly, r.From, loc); err != nil {
			return from, to, invalid
		}
	}
	if r.To != "" {
		last, err := time.ParseInLocation(time.DateOnly, r.To, loc)
		if err != nil {
			return from, to, invalid
		}
		to = last.AddDate(0, 0, 1).Add(-time.Second)
	}
	if !from.IsZero() && !to.IsZero() && to.Before(from) {
		return from, to, invalid
	}
	return from, to, nil
}

// Words are the request's text, as words to find (see Words).
func (r Request) Words() Words { return WordsOf(r.Text) }

// Read reads a page of a list. Each item goes to take, which says whether
// the page takes it, and as what view: cheap tests first, then the view,
// then what only the view says.
func Read[T, V any](tx *txn.Tx, k txn.Kind[T], l txn.List, r Request, take func(*T) (V, bool, error)) (Page[V], error) {
	limit := r.Limit
	switch {
	case limit <= 0:
		limit = DefaultLimit
	case limit > MaxLimit:
		limit = MaxLimit
	}
	page := Page[V]{Items: []V{}}
	looked := 0
	next, err := k.Each(tx, l, r.After, func(item *T) (bool, error) {
		looked++
		v, ok, err := take(item)
		if err != nil {
			return false, err
		}
		if ok {
			page.Items = append(page.Items, v)
		}
		return len(page.Items) < limit && looked < Budget, nil
	})
	page.Next = next
	return page, err
}

// OneOf reports whether v is one of a filter's values; an empty filter
// takes every value.
func OneOf[T comparable](filter []T, v T) bool {
	return len(filter) == 0 || slices.Contains(filter, v)
}

// AnyOf reports whether any of vs is one of a filter's values; an empty
// filter takes everything, even none.
func AnyOf[T comparable](filter, vs []T) bool {
	return len(filter) == 0 || slices.ContainsFunc(vs, func(v T) bool { return slices.Contains(filter, v) })
}

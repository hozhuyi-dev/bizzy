package googlesync

import (
	"context"
	"sync"

	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/platform/txn"
)

// known is what a request knows of a calendar's events, read or written
// moments ago in it. A write needn't read its event again first: it writes
// over the event as known (its etag), which Google refuses if the user
// changed it since, as the read would have found. Each request starts
// knowing nothing, so an edit made between requests is always read.
type known struct {
	mu     sync.Mutex
	events map[string]calendar.Event
}

type knownKey struct{ calendar string }

// knownEvents is what the request knows of cal's events; nil outside a
// request, which knows nothing.
func knownEvents(ctx context.Context, cal calendar.Calendar) *known {
	scope := txn.ScopeOf(ctx)
	if scope == nil {
		return nil
	}
	return scope.Value(knownKey{cal.ID()}, func() any { return &known{events: map[string]calendar.Event{}} }).(*known)
}

func (k *known) get(id string) (calendar.Event, bool) {
	if k == nil {
		return calendar.Event{}, false
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	e, ok := k.events[id]
	return e, ok
}

func (k *known) put(events ...calendar.Event) {
	if k == nil {
		return
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	for _, e := range events {
		k.events[e.ID] = e
	}
}

func (k *known) forget(id string) {
	if k == nil {
		return
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	delete(k.events, id)
}

// event is an event as the request last saw it, read from Google if it
// hasn't yet.
func (s *Sync) event(ctx context.Context, cal calendar.Calendar, id string) (calendar.Event, error) {
	k := knownEvents(ctx, cal)
	if e, ok := k.get(id); ok {
		return e, nil
	}
	e, err := cal.Get(ctx, id)
	if err == nil {
		k.put(e)
	}
	return e, err
}

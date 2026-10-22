package googlesync_test

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/testutil/fakecal"
)

// counted is the fake calendar, counting the calls bizzy makes to it.
type counted struct {
	*fakecal.Calendar
	calls *atomic.Int32
}

func (c counted) Changed(ctx context.Context, since, from, to time.Time) ([]calendar.Event, error) {
	c.calls.Add(1)
	return c.Calendar.Changed(ctx, since, from, to)
}

func (c counted) Get(ctx context.Context, id string) (calendar.Event, error) {
	c.calls.Add(1)
	return c.Calendar.Get(ctx, id)
}

func (c counted) Insert(ctx context.Context, in calendar.EventInput) (calendar.Event, error) {
	c.calls.Add(1)
	return c.Calendar.Insert(ctx, in)
}

func (c counted) Update(ctx context.Context, id, etag string, in calendar.EventInput) (calendar.Event, error) {
	c.calls.Add(1)
	return c.Calendar.Update(ctx, id, etag, in)
}

func (c counted) Delete(ctx context.Context, id, etag string) error {
	c.calls.Add(1)
	return c.Calendar.Delete(ctx, id, etag)
}

// Adding the client a calendar's events name lets them all in, in one
// request: each event read once to try it again, then written once, a few
// at a time.
func TestWaitingEditsGoInWithTheirClient(t *testing.T) {
	a, _ := setup(t)
	var calls atomic.Int32
	a.Sync.Calendar = func(context.Context) (calendar.Calendar, error) { return counted{a.Calendar, &calls}, nil }
	a.Sync.Parallel = 4
	sync(t, a)
	var events []string
	for day := range 6 {
		events = append(events, a.Calendar.UserAdd("Zed Ong", at(24*day+2), at(24*day+3)))
	}
	sync(t, a)
	if got := len(waiting(t, a)); got != 6 {
		t.Fatalf("waiting: %d, want the 6 events, whose client isn't there yet", got)
	}

	calls.Store(0)
	if _, err := a.Client("Zed Ong", map[string]any{"feeRates": []map[string]any{{"cents": 9000}}}); err != nil {
		t.Fatal(err)
	}
	if got := waiting(t, a); len(got) != 0 {
		t.Fatalf("still waiting: %+v", got)
	}
	// Each read to try it again, then written over as read: no read between.
	if got := calls.Load(); got != 12 {
		t.Errorf("calendar calls: %d, want 12 (6 reads, 6 writes)", got)
	}
	for _, id := range events {
		e, err := a.Calendar.Get(t.Context(), id)
		if err != nil || !strings.Contains(e.Title, "Zed Ong") || e.Private[calendar.PropSession] == "" {
			t.Errorf("event %s: %+v, %v; want it to show the session and carry its id", id, e, err)
		}
	}

	// Nothing more to write: the next sync agrees.
	calls.Store(0)
	sync(t, a)
	if got := calls.Load(); got != 1 {
		t.Errorf("a sync after: %d calendar calls, want only the read of what changed", got)
	}
}

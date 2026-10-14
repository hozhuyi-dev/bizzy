// Package recovery finishes what a request that died partway left undone.
//
// A mutation is several writes: to Google, then the stores, then whatever
// the reconcile re-derives from them. Most aren't one transaction, so a
// Lambda timeout or a lost connection between two leaves the stores half
// changed: a document cancelled with its session still flagged against
// it, a client's new home-visit habit with their sessions not re-derived.
//
// So the router notes every mutation before it runs and drops the note once
// it finished (or was refused). A note still there after a request could
// last means one died. The next sync then repairs everything a crash can
// leave behind: a full reconcile re-derives every session, package and
// client, and the attachments are put back in step with their owners.
package recovery

import (
	"context"
	"log/slog"
	"time"
)

// Entry is a mutation that started.
type Entry struct {
	ID        string    `json:"id" dynamodbav:"id"`
	Action    string    `json:"action" dynamodbav:"action"`
	StartedAt time.Time `json:"startedAt" dynamodbav:"startedAt"`
}

// Store keeps the entries.
type Store interface {
	Put(ctx context.Context, e Entry) error
	Delete(ctx context.Context, id string) error
	List(ctx context.Context) ([]Entry, error)
}

// Journal is the router's note of each mutation (router.Journal).
type Journal struct {
	Store Store
	NewID func() string
	Now   func() time.Time
}

func (j Journal) Begin(ctx context.Context, action string) (string, error) {
	e := Entry{ID: j.NewID(), Action: action, StartedAt: j.Now().UTC()}
	return e.ID, j.Store.Put(ctx, e)
}

func (j Journal) End(ctx context.Context, id string) error {
	return j.Store.Delete(ctx, id)
}

// Healer repairs after requests that died.
type Healer struct {
	Store Store
	// StaleAfter is how long a request can run: an entry older than that is
	// one that died, not one still running.
	StaleAfter time.Duration
	// Repairs put right everything a crash can leave; each is safe to run
	// any time.
	Repairs []func(ctx context.Context) error
	Now     func() time.Time
}

// Heal repairs once if any request other than the current one (its entry
// id, "" when none) died, then drops their entries. It reports how many.
func (h Healer) Heal(ctx context.Context, current string) (int, error) {
	all, err := h.Store.List(ctx)
	if err != nil {
		return 0, err
	}
	cutoff := h.Now().Add(-h.StaleAfter)
	var died []Entry
	for _, e := range all {
		if e.ID != current && !e.StartedAt.After(cutoff) {
			died = append(died, e)
		}
	}
	if len(died) == 0 {
		return 0, nil
	}
	for _, e := range died {
		slog.WarnContext(ctx, "repairing after a request that died", "action", e.Action, "startedAt", e.StartedAt)
	}
	for _, repair := range h.Repairs {
		if err := repair(ctx); err != nil {
			return 0, err
		}
	}
	for _, e := range died {
		if err := h.Store.Delete(ctx, e.ID); err != nil {
			return 0, err
		}
	}
	return len(died), nil
}

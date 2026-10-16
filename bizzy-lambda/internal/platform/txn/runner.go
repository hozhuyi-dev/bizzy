// Package txn is how anything in bizzy changes. An action is a function of
// a Tx; the Runner runs it in four steps:
//
//  1. Begin: note the commit counter (see platform/table).
//  2. Run the action. It reads and changes items through the Tx, which
//     writes nothing yet; then the checks it left for Later. If it or one
//     of them returns an error, nothing is written.
//  3. Check every Invariant on every item the action changed. One that
//     breaks is a bug (an action let through what it must refuse): it is
//     reported as an internal error, and nothing is written.
//  4. Commit the changes in one transaction, if the counter hasn't moved;
//     otherwise another commit went first, and the action runs again from
//     step 1, on what is stored now.
//
// Because every commit moves the one counter, commits happen one at a
// time, as if the app had a single user at a single device, which it
// nearly does. So an action needs no thought about concurrency: what it
// read is still true when its changes are written.
//
// After a commit, the Runner's After hook does what follows outside the
// table (writing the calendar). It runs once per commit; if it fails, the
// next sync finishes it.
package txn

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/table"
)

// commits is the counter every commit moves on.
var commits = table.Key{PK: "COMMIT", SK: "COUNTER"}

// maxAttempts bounds the reruns when other commits keep going first.
const maxAttempts = 5

// Invariant is a rule that holds for every stored item of a kind, always.
// A feature's actions refuse what would break it (with a message and
// remedies); the Runner checks it again before every commit, and the
// simulation over everything stored after every step, to catch an action
// that doesn't.
type Invariant struct {
	ID  string
	Why string
	// On is the kind it is checked for (Kind.Name).
	On string
	// Broken lists what breaks it for one item of On, read through tx as
	// the commit leaves it. A commit checks the items it changed, deleted
	// ones included; CheckAll checks every stored one. So a rule between
	// two kinds is written from both sides: "a session's client exists"
	// (on sessions) and "a deleted client has no sessions" (on clients).
	Broken func(tx *Tx, id string) ([]string, error)
}

type Runner struct {
	Table      table.Table
	Invariants []Invariant
	// After runs once a commit is written.
	After func(ctx context.Context, changes []Change)
	Now   func() time.Time
	// Location is the user's time zone.
	Location *time.Location
	NewID    func() string
}

// Quiet is the runner without its After hook, for what After itself
// commits.
func (r *Runner) Quiet() *Runner {
	q := *r
	q.After = nil
	return &q
}

// Run runs an action and commits what it changed (see the package doc).
func Run[T any](ctx context.Context, r *Runner, action func(tx *Tx) (T, error)) (T, error) {
	var zero T
	for attempt := 1; ; attempt++ {
		tx, err := r.begin(ctx)
		if err != nil {
			return zero, err
		}
		out, err := action(tx)
		if err != nil {
			return zero, err
		}
		for _, check := range tx.later {
			if err := check(); err != nil {
				return zero, &LateError{Err: err}
			}
		}
		changes, writes, err := tx.changes()
		if err != nil || len(changes) == 0 {
			return out, err
		}
		if err := r.check(tx, changes); err != nil {
			return zero, err
		}
		err = r.Table.Commit(ctx, commits, tx.counter, writes)
		switch {
		case errors.Is(err, table.ErrConflict) && attempt < maxAttempts:
			continue
		case errors.Is(err, table.ErrConflict):
			return zero, apperr.Conflict("Something else changed at the same moment. Try again.")
		case err != nil:
			return zero, err
		}
		if r.After != nil {
			r.After(ctx, changes)
		}
		return out, nil
	}
}

// Read runs a function that only reads. Changing anything is a bug.
func Read[T any](ctx context.Context, r *Runner, read func(tx *Tx) (T, error)) (T, error) {
	var zero T
	tx, err := r.begin(ctx)
	if err != nil {
		return zero, err
	}
	tx.readOnly = true
	out, err := read(tx)
	if err != nil {
		return zero, err
	}
	if changes, _, err := tx.changes(); err != nil || len(changes) > 0 {
		return zero, errors.Join(errReadOnly, err)
	}
	return out, nil
}

func (r *Runner) begin(ctx context.Context) (*Tx, error) {
	counter, err := r.Table.Counter(ctx, commits)
	if err != nil {
		return nil, err
	}
	return &Tx{
		ctx: ctx, table: r.Table, now: r.Now(), location: r.Location, newID: r.NewID, counter: counter,
		entries: map[table.Key]*entry{},
	}, nil
}

// check runs every invariant on every changed item it is on.
func (r *Runner) check(tx *Tx, changes []Change) error {
	tx.readOnly = true
	defer func() { tx.readOnly = false }()
	var broken []string
	for _, c := range changes {
		for _, inv := range r.Invariants {
			if inv.On != c.Kind {
				continue
			}
			what, err := inv.Broken(tx, c.ID)
			if err != nil {
				return err
			}
			for _, w := range what {
				broken = append(broken, inv.ID+": "+w)
			}
		}
	}
	if len(broken) > 0 {
		slog.ErrorContext(tx.ctx, "an action broke an invariant", "broken", broken)
		return fmt.Errorf("txn: would break %s", strings.Join(broken, "; "))
	}
	return nil
}

// AnyKind is a Kind of any item type.
type AnyKind interface {
	KindName() string
	KindDoc() Doc
	Fields() []Field
	IDs(tx *Tx) ([]string, error)
}

// CheckAll checks every invariant on every stored item of the kinds given:
// what the simulation runs after every step.
func CheckAll(ctx context.Context, r *Runner, kinds ...AnyKind) ([]string, error) {
	return Read(ctx, r, func(tx *Tx) ([]string, error) {
		var broken []string
		for _, inv := range r.Invariants {
			i := slices.IndexFunc(kinds, func(k AnyKind) bool { return k.KindName() == inv.On })
			if i < 0 {
				return nil, fmt.Errorf("txn: invariant %s is on %s, which CheckAll wasn't given", inv.ID, inv.On)
			}
			all, err := kinds[i].IDs(tx)
			if err != nil {
				return nil, err
			}
			for _, id := range all {
				what, err := inv.Broken(tx, id)
				if err != nil {
					return nil, err
				}
				for _, w := range what {
					broken = append(broken, inv.ID+": "+w)
				}
			}
		}
		return broken, nil
	})
}

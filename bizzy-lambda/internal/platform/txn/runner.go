// Package txn is how anything in bizzy changes. An action is a function of
// a Tx; the Runner runs it in four steps:
//
//  1. Begin: read every partition's version (see platform/table), and
//     check the table is at the code's schema (see schema.go).
//  2. Run the action. It reads and changes items through the Tx, which
//     writes nothing yet; then the checks it left for Later. If it or one
//     of them returns an error, nothing is written.
//  3. Check every Invariant on every item the action changed. One that
//     breaks is a bug (an action let through what it must refuse): it is
//     reported as an internal error, and nothing is written.
//  4. Commit the changes in one transaction, if no partition the action
//     read or wrote has moved since it began; otherwise another commit
//     went first, and the action runs again from step 1, on what is
//     stored now.
//
// So commits that touch the same partitions happen one at a time, as if
// the app had a single user at a single device, which it nearly does, and
// an action needs no thought about concurrency: what it read is still
// true when its changes are written.
//
// A run reads each item and query once, and reads from memory what the
// Runner kept from earlier runs while its partition hasn't moved (see
// cache.go): a run that read only that sees the table as it was when it
// began. One that commits nothing (an error, no changes, or a Read) but
// read from the table is only trusted if those partitions are still where
// they began; otherwise it may have seen half of another commit, and it
// runs again too.
//
// After a commit, the Runner's After hook does what follows outside the
// table (writing the calendar), or leaves it for the end of the request
// (see Scope). If it fails, the next sync finishes it.
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

// Commits is the item holding every partition's version, which every
// commit moves on, the migrator's too (see platform/migrate).
var Commits = table.Key{PK: "COMMIT", SK: "COUNTER"}

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
	// Schema is the version of the stored items this code reads
	// (migrations.Version): the Runner serves only a table at it (see
	// schema.go).
	Schema int
	// Migrator serves the table at any version, even while migrating: the
	// migrator's own Runner (see platform/migrate).
	Migrator bool

	// kept is what runs read, kept for later ones (see cache.go).
	kept *cache
}

// Quiet is the runner without its After hook, for what After itself
// commits.
func (r *Runner) Quiet() *Runner {
	r.cache() // shared with the copy
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
		out, changes, writes, err := prepare(tx, r, action)
		if err == nil && len(changes) > 0 {
			err = r.commit(tx, writes)
		} else {
			err = r.settle(tx, err)
		}
		var broken *brokenError
		switch {
		case errors.Is(err, table.ErrConflict) && attempt < maxAttempts:
			continue
		case errors.Is(err, table.ErrConflict):
			return zero, errBusy
		case errors.As(err, &broken):
			slog.ErrorContext(ctx, "an action broke an invariant", "broken", broken.broken)
			return zero, err
		case err != nil:
			return zero, err
		}
		if len(changes) > 0 {
			if s := ScopeOf(ctx); s != nil {
				s.note(changes)
			}
			if r.After != nil {
				r.After(ctx, changes)
			}
		}
		return out, nil
	}
}

// prepare runs steps 2 and 3: the action, its Later checks, and the
// invariants on what it changed.
func prepare[T any](tx *Tx, r *Runner, action func(tx *Tx) (T, error)) (T, []Change, []table.Write, error) {
	var zero T
	out, err := action(tx)
	if err != nil {
		return zero, nil, nil, err
	}
	for _, check := range tx.later {
		if err := check(); err != nil {
			return zero, nil, nil, &LateError{Err: err}
		}
	}
	changes, writes, err := tx.changes()
	if err == nil && len(changes) > 0 {
		err = r.check(tx, changes)
	}
	if err != nil {
		return zero, nil, nil, err
	}
	return out, changes, writes, nil
}

// Read runs a function that only reads. Changing anything is a bug.
func Read[T any](ctx context.Context, r *Runner, read func(tx *Tx) (T, error)) (T, error) {
	var zero T
	for attempt := 1; ; attempt++ {
		tx, err := r.begin(ctx)
		if err != nil {
			return zero, err
		}
		tx.readOnly = true
		out, err := read(tx)
		if err == nil {
			if changes, _, cerr := tx.changes(); cerr != nil || len(changes) > 0 {
				err = errors.Join(errReadOnly, cerr)
			}
		}
		switch err := r.settle(tx, err); {
		case errors.Is(err, table.ErrConflict) && attempt < maxAttempts:
			continue
		case errors.Is(err, table.ErrConflict):
			return zero, errBusy
		case err != nil:
			return zero, err
		}
		return out, nil
	}
}

// errBusy is what the app shows when other commits kept going first.
var errBusy = apperr.Conflict("Something else changed at the same moment. Try again.")

// settle is how a run that committed nothing ends, with err or none: as
// it is if every partition it read from the table is where it was when
// the run began, and as ErrConflict if one moved, since then its reads may
// straddle another commit. What it read is kept for later runs.
func (r *Runner) settle(tx *Tx, err error) error {
	if len(tx.fetched) == 0 {
		return err // All from memory: the table as it was at the start.
	}
	Count(tx.ctx, "reads")
	now, verr := r.Table.Versions(tx.ctx, Commits)
	if verr != nil {
		return errors.Join(err, verr)
	}
	for pk := range tx.fetched {
		if now[pk] != tx.versions[pk] {
			return table.ErrConflict
		}
	}
	r.cache().keep(tx.versions, tx.fetched, nil, nil)
	return err
}

// commit writes a run's changes if nothing it read or writes moved since
// it began, and keeps what it read and wrote for later runs.
func (r *Runner) commit(tx *Tx, writes []table.Write) error {
	read := table.Versions{}
	for pk := range tx.read {
		read[pk] = tx.versions[pk]
	}
	for _, w := range writes {
		read[w.PK()] = tx.versions[w.PK()]
	}
	Count(tx.ctx, "commits")
	moved, err := r.Table.Commit(tx.ctx, Commits, read, writes)
	if err != nil {
		return err
	}
	r.cache().keep(tx.versions, tx.fetched, writes, moved)
	return nil
}

func (r *Runner) begin(ctx context.Context) (*Tx, error) {
	Count(ctx, "reads")
	versions, err := r.Table.Versions(ctx, Commits)
	if err != nil {
		return nil, err
	}
	c := r.cache()
	c.prune(versions)
	tx := &Tx{
		ctx: ctx, table: r.Table, cache: c, now: r.Now(), location: r.Location, newID: r.NewID, versions: versions,
		entries: map[table.Key]*entry{}, read: map[string]bool{}, fetched: map[string]*part{},
	}
	// Read in the run: a migration that starts before its commit moves the
	// schema, so the commit fails and its rerun meets the fence.
	if err := r.checkSchema(tx); err != nil {
		return nil, err
	}
	return tx, nil
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
		return &brokenError{broken}
	}
	return nil
}

// brokenError is a commit refused for breaking invariants. Run logs it,
// once it knows the action read one state, so it is a bug, not a run
// that straddled another commit.
type brokenError struct{ broken []string }

func (e *brokenError) Error() string { return "txn: would break " + strings.Join(e.broken, "; ") }

// AnyKind is a Kind of any item type.
type AnyKind interface {
	KindName() string
	KindDoc() Doc
	Fields() []Field
	IDs(tx *Tx) ([]string, error)
	Rewrite(it table.Item) (table.Item, error)
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

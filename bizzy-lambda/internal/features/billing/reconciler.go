package billing

import (
	"context"
	"reflect"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
)

type ClientStore interface {
	List(ctx context.Context) ([]clients.Client, error)
	SaveActivity(ctx context.Context, client clients.Client) error
}

type SessionStore interface {
	ListByClient(ctx context.Context, clientID string) ([]sessions.Session, error)
	ListOpen(ctx context.Context) ([]sessions.Session, error)
	Save(ctx context.Context, s sessions.Session) error
	Delete(ctx context.Context, eventID string) (bool, error)
}

type PackageStore interface {
	Get(ctx context.Context, id string) (packages.Package, bool, error)
	ListByClient(ctx context.Context, clientID string) ([]packages.Package, error)
	Save(ctx context.Context, p packages.Package) error
	Delete(ctx context.Context, id string) (bool, error)
}

type SettingsStore interface {
	Get(ctx context.Context) (settings.Settings, error)
}

// Reconciler re-derives the sessions and packages a change can affect and
// writes back only what differs, so a quiet nightly sync costs almost no
// writes.
type Reconciler struct {
	Clients  ClientStore
	Sessions SessionStore
	Packages PackageStore
	Settings SettingsStore
	Location *time.Location
}

// Change is a session as stored (Before, nil when new) and as it should now
// read from the calendar (After, nil when it is gone).
type Change struct {
	Before, After *sessions.Session
}

// Scope says what to reconcile. A client's sessions are always reconciled
// together, because package credits run across all of them.
type Scope struct {
	Changes   []Change
	ClientIDs []string
	// Unmatched re-derives every open session without a client, for when a
	// client gains an alias.
	Unmatched bool
	// AllClients reconciles everything, for settings that affect every
	// session.
	AllClients bool
}

type Result struct {
	Saved   int `json:"saved"`
	Deleted int `json:"deleted"`
}

func (r *Reconciler) Reconcile(ctx context.Context, scope Scope) (Result, error) {
	var result Result

	cfg, err := r.Settings.Get(ctx)
	if err != nil {
		return result, err
	}
	allClients, err := r.Clients.List(ctx)
	if err != nil {
		return result, err
	}
	env := NewEnv(allClients, cfg.HomeVisitColorID, r.Location)

	affected := map[string]bool{}
	for _, id := range scope.ClientIDs {
		affected[id] = true
	}
	if scope.AllClients {
		for _, c := range allClients {
			affected[c.ID] = true
		}
	}

	// original is what is stored, to diff against; current is what to derive.
	original := map[string]sessions.Session{}
	current := map[string]sessions.Session{}
	gone := map[string]bool{}

	for _, c := range scope.Changes {
		if c.Before != nil {
			original[c.Before.EventID] = *c.Before
			if c.Before.ClientID != "" {
				affected[c.Before.ClientID] = true
			}
		}
		if c.After != nil {
			current[c.After.EventID] = *c.After
		} else if c.Before != nil {
			gone[c.Before.EventID] = true
		}
	}

	if scope.Unmatched || scope.AllClients {
		open, err := r.Sessions.ListOpen(ctx)
		if err != nil {
			return result, err
		}
		for _, s := range open {
			if s.ClientID != "" {
				continue
			}
			if _, ok := original[s.EventID]; !ok {
				original[s.EventID] = s
			}
			if _, ok := current[s.EventID]; !ok && !gone[s.EventID] {
				current[s.EventID] = s
			}
		}
	}

	// Load each affected client's whole history. Deriving can match a session
	// to a client not loaded yet (an alias moved), so repeat until stable.
	storedPackages := map[string]packages.Package{}
	loaded := map[string]bool{}
	for {
		for _, s := range current {
			if e := Derive(s, env); e.Session.ClientID != "" {
				affected[e.Session.ClientID] = true
			}
		}

		pending := false
		for id := range affected {
			if loaded[id] {
				continue
			}
			pending, loaded[id] = true, true

			history, err := r.Sessions.ListByClient(ctx, id)
			if err != nil {
				return result, err
			}
			for _, s := range history {
				if _, ok := original[s.EventID]; !ok {
					original[s.EventID] = s
				}
				if _, ok := current[s.EventID]; !ok && !gone[s.EventID] {
					current[s.EventID] = s
				}
			}

			pkgs, err := r.Packages.ListByClient(ctx, id)
			if err != nil {
				return result, err
			}
			for _, p := range pkgs {
				storedPackages[p.ID] = p
			}
		}
		if !pending {
			break
		}
	}

	entries := make(map[string]*Entry, len(current))
	for id, s := range current {
		e := Derive(s, env)
		entries[id] = &e
	}

	finalPackages, deletePackages, err := r.calendarPackages(ctx, entries, storedPackages)
	if err != nil {
		return result, err
	}

	// Allocate per client.
	entriesByClient := map[string][]*Entry{}
	for _, e := range entries {
		if e.Session.ClientID != "" {
			entriesByClient[e.Session.ClientID] = append(entriesByClient[e.Session.ClientID], e)
		}
	}
	packagesByClient := map[string][]*packages.Package{}
	for id := range finalPackages {
		p := finalPackages[id]
		packagesByClient[p.ClientID] = append(packagesByClient[p.ClientID], p)
	}
	for id := range affected {
		Allocate(env.Clients[id], entriesByClient[id], packagesByClient[id])
	}

	// Write sessions.
	for id, e := range entries {
		s := e.Session
		s.Drift = SessionDrift(s, r.Location)

		if s.Removed && s.Document == nil {
			gone[id] = true
			continue
		}
		if before, ok := original[id]; ok && same(before, s) {
			continue
		}
		if err := r.Sessions.Save(ctx, s); err != nil {
			return result, err
		}
		result.Saved++
	}
	for id := range gone {
		if _, stored := original[id]; !stored {
			continue
		}
		// False means a receipt claimed it meanwhile; the next sync keeps it.
		deleted, err := r.Sessions.Delete(ctx, id)
		if err != nil {
			return result, err
		}
		if deleted {
			result.Deleted++
		}
	}

	// Write packages.
	for id, p := range finalPackages {
		p.Drift = PackageDrift(*p)
		if stored, ok := storedPackages[id]; ok && same(stored, *p) {
			continue
		}
		if err := r.Packages.Save(ctx, *p); err != nil {
			return result, err
		}
	}
	for _, id := range deletePackages {
		if _, err := r.Packages.Delete(ctx, id); err != nil {
			return result, err
		}
	}

	// Write client activity.
	for id := range affected {
		client, ok := env.Clients[id]
		if !ok {
			continue
		}
		activity, last := Activity(entriesByClient[id], packagesByClient[id], r.Location)
		updated := client
		updated.Activity, updated.LastSessionAt = activity, last
		if same(client, updated) {
			continue
		}
		if err := r.Clients.SaveActivity(ctx, updated); err != nil {
			return result, err
		}
	}

	return result, nil
}

// calendarPackages lines up the packages bought in session titles with the
// stored ones: new ones are added, changed ones updated, and ones no longer
// in any title deleted (or kept as removed when a receipt covers them).
func (r *Reconciler) calendarPackages(ctx context.Context, entries map[string]*Entry, stored map[string]packages.Package) (map[string]*packages.Package, []string, error) {
	final := map[string]*packages.Package{}
	var deletes []string

	desired := map[string]packages.Package{}
	for _, e := range entries {
		if p, ok := CalendarPackage(*e); ok {
			desired[p.ID] = p
		}
	}

	for id, p := range stored {
		if p.Source != packages.SourceCalendar {
			final[id] = &p
			continue
		}
		want, ok := desired[id]
		switch {
		case ok:
			merged := mergeCalendarPackage(p, want)
			final[id] = &merged
		case p.Document != nil:
			p.Removed = true
			final[id] = &p
		default:
			// Its client is affected, so every session of theirs is loaded:
			// none buys this package any more.
			deletes = append(deletes, id)
		}
	}

	for id, want := range desired {
		if _, ok := final[id]; ok {
			continue
		}
		// Stored under a client this run did not load: fetch it so its
		// receipt link is kept.
		existing, found, err := r.Packages.Get(ctx, id)
		if err != nil {
			return nil, nil, err
		}
		if found {
			stored[id] = existing
			merged := mergeCalendarPackage(existing, want)
			final[id] = &merged
			continue
		}
		final[id] = &want
	}

	return final, deletes, nil
}

func mergeCalendarPackage(stored, want packages.Package) packages.Package {
	merged := stored
	merged.ClientID = want.ClientID
	merged.Sessions = want.Sessions
	merged.PriceCents = want.PriceCents
	merged.PurchasedAt = want.PurchasedAt
	merged.Removed = false
	return merged
}

// same compares two items the way DynamoDB stores them, so time zones and
// nil-vs-empty differences that do not survive a round trip are ignored.
func same(a, b any) bool {
	am, errA := attributevalue.MarshalMap(a)
	bm, errB := attributevalue.MarshalMap(b)
	return errA == nil && errB == nil && reflect.DeepEqual(am, bm)
}

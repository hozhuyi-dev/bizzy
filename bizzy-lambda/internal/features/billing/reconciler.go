package billing

import (
	"context"
	"errors"
	"maps"
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/dynamo"
)

type ClientStore interface {
	List(ctx context.Context) ([]clients.Client, error)
	SaveActivity(ctx context.Context, client clients.Client) error
}

type SessionStore interface {
	Get(ctx context.Context, eventID string) (sessions.Session, bool, error)
	ListByClient(ctx context.Context, clientID string) ([]sessions.Session, error)
	ListWithoutClient(ctx context.Context) ([]sessions.Session, error)
	Save(ctx context.Context, s sessions.Session) (sessions.Session, error)
	Delete(ctx context.Context, s sessions.Session) error
}

type PackageStore interface {
	Get(ctx context.Context, id string) (packages.Package, bool, error)
	ListByClient(ctx context.Context, clientID string) ([]packages.Package, error)
	Save(ctx context.Context, p packages.Package) error
}

type SettingsStore interface {
	Get(ctx context.Context) (settings.Settings, error)
}

// Reconciler re-derives the sessions and packages a change can affect and
// writes back only what differs, so a quiet sync costs almost no writes.
type Reconciler struct {
	Clients  ClientStore
	Sessions SessionStore
	Packages PackageStore
	Settings SettingsStore
	Location *time.Location
	// Now defaults to time.Now.
	Now func() time.Time
	// Purge removes what a deleted session keeps outside its item: the
	// files attached to it. Nil keeps nothing outside.
	Purge func(ctx context.Context, eventID string) error
}

// Change is what the calendar now says about one session's event: Event is
// nil when it is gone (deleted, cancelled, or no longer a session).
type Change struct {
	EventID string
	Event   *calendar.Event
	// Discard drops a gone session with her data on it too, instead of
	// keeping it as deleted: she deleted it in the app. A session with a
	// document is always kept.
	Discard bool
}

// Scope says what to reconcile. A client's sessions are always reconciled
// together, because package credits run across all of them.
type Scope struct {
	Changes []Change
	// ClientIDs are the clients to reconcile; "" (no client) is ignored.
	ClientIDs []string
	// EventIDs are stored sessions to re-derive as they are, with their
	// clients: the session that bought a package that changed.
	EventIDs []string
	// Unmatched re-derives every session without a client, for when a
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

// maxAttempts bounds the retries when a session changed while reconciling
// (her edit, or another sync): each attempt reads everything afresh.
const maxAttempts = 4

func (r *Reconciler) Reconcile(ctx context.Context, scope Scope) (Result, error) {
	for attempt := 1; ; attempt++ {
		result, err := r.reconcile(ctx, scope)
		if errors.Is(err, dynamo.ErrConflict) && attempt < maxAttempts {
			continue
		}
		return result, err
	}
}

func (r *Reconciler) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

func (r *Reconciler) reconcile(ctx context.Context, scope Scope) (Result, error) {
	var result Result

	cfg, err := r.Settings.Get(ctx)
	if err != nil {
		return result, err
	}
	allClients, err := r.Clients.List(ctx)
	if err != nil {
		return result, err
	}
	now := r.now()
	env := NewEnv(allClients, cfg, r.Location, now)

	affected := map[string]bool{}
	for _, id := range scope.ClientIDs {
		if id != "" {
			affected[id] = true
		}
	}
	if scope.AllClients {
		for _, c := range allClients {
			affected[c.ID] = true
		}
	}

	// original is what is stored, to diff against and to carry the version;
	// current is what to derive from.
	original := map[string]sessions.Session{}
	current := map[string]sessions.Session{}
	gone := map[string]bool{}
	storedPackages := map[string]packages.Package{}
	owners := map[string]string{}

	for _, c := range scope.Changes {
		stored, found, err := r.Sessions.Get(ctx, c.EventID)
		if err != nil {
			return result, err
		}
		if found {
			original[c.EventID] = stored
			if stored.ClientID != "" {
				affected[stored.ClientID] = true
			}
		}
		// The package the event bought, under whichever client it is, is
		// linked, held or unlinked by what the event now says.
		owner, err := r.packageOwner(ctx, c.EventID, storedPackages, owners)
		if err != nil {
			return result, err
		}
		if owner != "" {
			affected[owner] = true
		}

		switch {
		case c.Event != nil:
			current[c.EventID] = withEvent(stored, *c.Event)
		case !found:
		case stored.HasDocuments() || (stored.HasHerData() && !c.Discard):
			// Kept for what she recorded, until she restores or discards it.
			if stored.RemovedAt == nil {
				stored.RemovedAt = ptr(now.UTC())
			}
			current[c.EventID] = stored
		default:
			gone[c.EventID] = true
		}
	}

	for _, id := range scope.EventIDs {
		stored, found, err := r.Sessions.Get(ctx, id)
		if err != nil {
			return result, err
		}
		if found {
			keep(original, current, gone, stored)
			if stored.ClientID != "" {
				affected[stored.ClientID] = true
			}
		}
	}

	if scope.Unmatched || scope.AllClients {
		unmatched, err := r.Sessions.ListWithoutClient(ctx)
		if err != nil {
			return result, err
		}
		for _, s := range unmatched {
			keep(original, current, gone, s)
		}
	}

	// Load each affected client's whole history. Deriving can match a session
	// to a client not loaded yet (an alias moved), so repeat until stable.
	loaded := map[string]bool{}
	for {
		for _, s := range current {
			e := Derive(s, env)
			if e.Session.ClientID != "" {
				affected[e.Session.ClientID] = true
			}
			// The package the title buys may be stored under another client
			// (she moved it while it was unlinked): taking it back changes
			// their credits and income too.
			if p, ok := CalendarPackage(e); ok {
				owner, err := r.packageOwner(ctx, p.ID, storedPackages, owners)
				if err != nil {
					return result, err
				}
				if owner != "" {
					affected[owner] = true
				}
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
				keep(original, current, gone, s)
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

	finalPackages, err := r.calendarPackages(ctx, env, entries, gone, storedPackages)
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
		Allocate(env.Clients[id], entriesByClient[id], packagesByClient[id], r.Location)
	}

	// Write sessions.
	for id, e := range entries {
		s := e.Session
		s.Drift = SessionDrift(s, r.Location)

		// Deleted, and nothing of hers is left to keep it for.
		if s.RemovedAt != nil && !s.HasHerData() {
			gone[id] = true
			continue
		}
		if before, ok := original[id]; ok && dynamo.Same(before, s) {
			continue
		}
		if _, err := r.Sessions.Save(ctx, s); err != nil {
			return result, err
		}
		result.Saved++
	}
	for id := range gone {
		stored, ok := original[id]
		if !ok {
			continue
		}
		if err := r.Sessions.Delete(ctx, stored); err != nil {
			return result, err
		}
		if r.Purge != nil {
			if err := r.Purge(ctx, id); err != nil {
				return result, err
			}
		}
		result.Deleted++
	}

	// Write packages.
	for id, p := range finalPackages {
		p.Drift = PackageDrift(*p, r.Location)
		if stored, ok := storedPackages[id]; ok && dynamo.Same(stored, *p) {
			continue
		}
		if err := r.Packages.Save(ctx, *p); err != nil {
			return result, err
		}
	}
	// Write client activity.
	for id := range affected {
		client, ok := env.Clients[id]
		if !ok {
			continue
		}
		activity, last, next := Activity(entriesByClient[id], packagesByClient[id], r.Location)
		updated := client
		updated.Activity, updated.LastSessionAt, updated.NextBookedAt = activity, last, next
		if dynamo.Same(client, updated) {
			continue
		}
		if err := r.Clients.SaveActivity(ctx, updated); err != nil {
			return result, err
		}
	}

	return result, nil
}

// packageOwner is the client a package is stored under ("" when it isn't
// stored), read once per run.
func (r *Reconciler) packageOwner(ctx context.Context, id string, stored map[string]packages.Package, owners map[string]string) (string, error) {
	if p, ok := stored[id]; ok {
		return p.ClientID, nil
	}
	if owner, ok := owners[id]; ok {
		return owner, nil
	}
	p, _, err := r.Packages.Get(ctx, id)
	if err != nil {
		return "", err
	}
	owners[id] = p.ClientID
	return p.ClientID, nil
}

// keep adds a stored session to reconcile as it is, unless a change already
// covers it.
func keep(original, current map[string]sessions.Session, gone map[string]bool, s sessions.Session) {
	if _, ok := original[s.EventID]; !ok {
		original[s.EventID] = s
	}
	if _, ok := current[s.EventID]; !ok && !gone[s.EventID] {
		current[s.EventID] = s
	}
}

// withEvent is the stored session (zero when new) as the calendar event now
// says it is. A deleted session whose event is back is restored.
func withEvent(stored sessions.Session, event calendar.Event) sessions.Session {
	s := stored
	s.EventID = event.ID
	s.Title, s.Start, s.End, s.ColorID = event.Title, event.Start.UTC(), event.End.UTC(), event.ColorID
	s.RemovedAt = nil
	return s
}

// calendarPackages lines up the packages bought in session titles with the
// stored ones: new ones are added and changed ones updated. One no title
// buys any more is unlinked: it becomes an app package, kept with its
// payment, credits and documents until she deletes it. Should the title buy
// it again, it is linked back rather than bought twice.
func (r *Reconciler) calendarPackages(ctx context.Context, env Env, entries map[string]*Entry, gone map[string]bool, stored map[string]packages.Package) (map[string]*packages.Package, error) {
	held, err := r.heldElsewhere(ctx, env, entries, gone, stored)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		p, ok := CalendarPackage(*e)
		if _, known := stored[p.ID]; !ok || known {
			continue
		}
		// Stored under a client this run did not load: fetch it so its
		// payment and document links are kept.
		existing, found, err := r.Packages.Get(ctx, p.ID)
		if err != nil {
			return nil, err
		}
		if found {
			stored[p.ID] = existing
		}
	}
	return linkPackages(entries, stored, held), nil
}

// heldElsewhere are the stored calendar packages whose session this run
// didn't load (one no client matches now, which a client's reconcile
// doesn't read) and whose title can't be read, matched or is tentative:
// still held, as linkPackages has it, whichever run looks. One this run
// deletes is gone, whatever is still stored.
func (r *Reconciler) heldElsewhere(ctx context.Context, env Env, entries map[string]*Entry, gone map[string]bool, stored map[string]packages.Package) (map[string]bool, error) {
	held := map[string]bool{}
	for id, p := range stored {
		if _, loaded := entries[id]; loaded || gone[id] || p.Source != packages.SourceCalendar {
			continue
		}
		s, found, err := r.Sessions.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		if found && holds(Derive(s, env)) {
			held[id] = true
		}
	}
	return held, nil
}

// holds says a session in the calendar keeps the package it bought as it
// is: its title can't be read, so what it buys can't be told, or it still
// buys one but no client matches it or it is still tentative.
func holds(e Entry) bool {
	s := e.Session
	if s.RemovedAt != nil || s.Status == "" || s.Status == sessions.StatusRemoved {
		return false
	}
	return s.Status == sessions.StatusParseError || e.Title.Package != nil
}

// linkPackages is calendarPackages over packages already read: each title's
// package merged into the stored one, or new, and the stored calendar
// packages no title buys unlinked. A title that can't be read, or still
// buys the package but can't be matched or is tentative, leaves it as it
// is (see holds): the session is what needs fixing, the package isn't gone.
func linkPackages(entries map[string]*Entry, stored map[string]packages.Package, heldElsewhere map[string]bool) map[string]*packages.Package {
	desired := map[string]packages.Package{}
	held := maps.Clone(heldElsewhere)
	for id, e := range entries {
		if p, ok := CalendarPackage(*e); ok {
			desired[p.ID] = p
			continue
		}
		if holds(*e) {
			held[id] = true
		}
	}

	final := map[string]*packages.Package{}
	for id, p := range stored {
		want, ok := desired[id]
		if ok && p.Source == packages.SourceCalendar {
			merged := mergeCalendarPackage(p, want)
			final[id] = &merged
			continue
		}
		if ok {
			// One she made standalone stays hers, whatever the title says:
			// the session buys nothing, and the package is collected on its
			// own.
			entries[id].Title.Package = nil
			final[id] = &p
			continue
		}
		// Its client is affected, so every session of theirs is loaded: none
		// buys this package any more, or the one that did is gone. One of the
		// app's never was.
		if p.Source == packages.SourceCalendar && !held[id] {
			p.Unlinked = true
		}
		final[id] = &p
	}
	for id, want := range desired {
		if _, ok := final[id]; !ok {
			final[id] = &want
		}
	}
	return final
}

func mergeCalendarPackage(stored, want packages.Package) packages.Package {
	merged := stored
	merged.ClientID = want.ClientID
	merged.Sessions = want.Sessions
	merged.PriceCents = want.PriceCents
	merged.PurchasedAt = want.PurchasedAt
	merged.Source, merged.Unlinked = packages.SourceCalendar, false
	return merged
}

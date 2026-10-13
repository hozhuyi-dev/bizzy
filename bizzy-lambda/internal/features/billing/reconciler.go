package billing

import (
	"context"
	"errors"
	"reflect"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"

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
	Changes   []Change
	ClientIDs []string
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
		affected[id] = true
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

	finalPackages, err := r.calendarPackages(ctx, entries, storedPackages)
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

		// Deleted, and nothing of hers is left to keep it for.
		if s.RemovedAt != nil && !s.HasHerData() {
			gone[id] = true
			continue
		}
		if before, ok := original[id]; ok && same(before, s) {
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
		result.Deleted++
	}

	// Write packages.
	for id, p := range finalPackages {
		if stored, ok := storedPackages[id]; ok && same(stored, *p) {
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
		if same(client, updated) {
			continue
		}
		if err := r.Clients.SaveActivity(ctx, updated); err != nil {
			return result, err
		}
	}

	return result, nil
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
func (r *Reconciler) calendarPackages(ctx context.Context, entries map[string]*Entry, stored map[string]packages.Package) (map[string]*packages.Package, error) {
	final := map[string]*packages.Package{}

	desired := map[string]packages.Package{}
	for _, e := range entries {
		if p, ok := CalendarPackage(*e); ok {
			desired[p.ID] = p
		}
	}

	for id, p := range stored {
		if want, ok := desired[id]; ok {
			merged := mergeCalendarPackage(p, want)
			final[id] = &merged
			continue
		}
		// Its client is affected, so every session of theirs is loaded: none
		// buys this package any more.
		p.Source = packages.SourceApp
		final[id] = &p
	}

	for id, want := range desired {
		if _, ok := final[id]; ok {
			continue
		}
		// Stored under a client this run did not load: fetch it so its
		// payment and document links are kept.
		existing, found, err := r.Packages.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		if found {
			stored[id] = existing
			merged := mergeCalendarPackage(existing, want)
			final[id] = &merged
			continue
		}
		final[id] = &want
	}

	return final, nil
}

func mergeCalendarPackage(stored, want packages.Package) packages.Package {
	merged := stored
	merged.ClientID = want.ClientID
	merged.Sessions = want.Sessions
	merged.PriceCents = want.PriceCents
	merged.PurchasedAt = want.PurchasedAt
	merged.Source = packages.SourceCalendar
	return merged
}

// same compares two items the way DynamoDB stores them, so time zones and
// nil-vs-empty differences that do not survive a round trip are ignored.
func same(a, b any) bool {
	am, errA := attributevalue.MarshalMap(a)
	bm, errB := attributevalue.MarshalMap(b)
	return errA == nil && errB == nil && reflect.DeepEqual(am, bm)
}

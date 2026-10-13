// Package simulation drives the whole backend the way the app and the
// outside world do, in random order, and checks after every step that the
// state still makes sense.
//
// The world is the production wiring (internal/app) over in-memory stores,
// a fake calendar, fake contacts and a clock. Actions come from four actors
// (actions_*.go): the user calling the router with JSON as the app does,
// the calendar and contacts changing underneath, and time passing. The
// checks (checks.go) are the entities' rule tables (statemodel), plus that
// a refused action changes nothing and the stored derived fields match a
// fresh recomputation.
//
// Run it longer to search deeper:
//
//	go test ./internal/simulation -rapid.checks=2000 -rapid.steps=200
package simulation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/app"
	"bizzy-lambda/internal/features/billing"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/router"
	"bizzy-lambda/internal/testutil/fakecal"
	"bizzy-lambda/internal/testutil/fakecontacts"
	"bizzy-lambda/internal/testutil/memdocs"
	"bizzy-lambda/internal/testutil/memory"
)

// The business runs in Kuala Lumpur; the clock starts on a Tuesday morning.
var (
	kl    = time.FixedZone("MYT", 8*60*60)
	epoch = time.Date(2026, 10, 13, 1, 0, 0, 0, time.UTC)
)

type World struct {
	Store    *memory.Store
	Docs     *memdocs.Repo
	Calendar *fakecal.Calendar
	Contacts *fakecontacts.Directory
	Now      time.Time
	App      app.App

	// InSync is false while the calendar, the contacts or the clock moved
	// since the last sync, so a sync would have something to do.
	InSync bool
	status *syncStatus
	// pendingSeen are the known gaps (integrity.Rule.Pending) this run
	// reached, logged once each.
	pendingSeen map[string]bool
}

// fataler is what newWorld needs of a test: *testing.T or *rapid.T.
type fataler interface {
	Helper()
	Fatalf(format string, args ...any)
}

// newWorld seeds a practice with a few clients and a week of calendar, and
// syncs it.
func newWorld(t fataler) *World {
	w := &World{
		Store:    memory.New(),
		Calendar: &fakecal.Calendar{},
		Contacts: &fakecontacts.Directory{},
		Now:      epoch,
		status:   &syncStatus{},

		pendingSeen: map[string]bool{},
	}
	w.Docs = memdocs.New(w.Store)
	ids := 0
	dynamo.NewID = func() string {
		ids++
		return fmt.Sprintf("id%03d", ids)
	}
	w.Store.SettingsVal = settings.Settings{BusinessName: "Physio Co", ServiceName: "Physiotherapy", HomeVisitColorID: "5"}

	for _, c := range seedClients {
		person := contactsPerson(c)
		w.Contacts.People = append(w.Contacts.People, person)
		link := person.Link(epoch)
		w.Store.ClientMap[c.ID] = clients.Client{
			ID: c.ID, Name: c.Name, Aliases: []string{clients.NormalizeAlias(c.Name)},
			Contact: &link, DefaultFeeCents: c.DefaultFeeCents, HomeVisits: c.HomeVisits,
		}
	}
	for i, e := range seedEvents {
		start := epoch.Add(e.offset)
		w.Calendar.Live = append(w.Calendar.Live, calendar.Event{
			ID: fmt.Sprintf("seed%d", i+1), Title: e.title, Start: start, End: start.Add(time.Hour), ETag: "1",
		})
	}

	w.App = app.New(w.deps(w.Store, w.Docs))
	if _, err := w.App.Sync(context.Background(), googlesync.Range{}); err != nil {
		t.Fatalf("seed sync: %v", err)
	}
	w.InSync = true
	return w
}

func (w *World) deps(m *memory.Store, docs *memdocs.Repo) app.Deps {
	return app.Deps{
		Clients: m.Clients(), Sessions: m.Sessions(), FollowUps: m.FollowUps(), Packages: m.Packages(),
		Settings: m.Settings(), Documents: docs, Payments: m.Payments(), SyncStatus: w.status,
		Calendar:  func(context.Context) (googlesync.Calendar, error) { return w.Calendar, nil },
		Directory: w.Contacts,
		Location:  kl,
		Now:       func() time.Time { return w.Now },
	}
}

// Call sends an action through the router with a JSON payload, exactly as
// the app does, and returns its data as JSON or the error it was refused
// with. An internal error fails the test: the app shows those as "Something
// went wrong", so each one is a bug. A refused action must change nothing,
// unless it may refresh: an edit refused because the calendar changed
// meanwhile applies that change first, so the user sees the latest.
func (w *World) Call(t *rapid.T, action string, payload any, mayRefresh bool) (json.RawMessage, *router.ErrorBody) {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal %s payload: %v", action, err)
	}
	before := w.snapshot()
	res, err := w.App.Router.Handle(context.Background(), router.Request{Action: action, Payload: body})
	if err != nil {
		t.Fatalf("%s: %v", action, err)
	}
	t.Logf("%s %s → %s", action, body, outcome(res))

	if res.Error != nil {
		if res.Error.Code == "internal" {
			t.Fatalf("%s failed with an internal error; see the log above", action)
		}
		if after := w.snapshot(); !mayRefresh && !after.equal(before) {
			t.Fatalf("%s was refused (%s) but changed %v", action, res.Error.Message, after.diff(before))
		}
		return nil, res.Error
	}
	data, err := json.Marshal(res.Data)
	if err != nil {
		t.Fatalf("marshal %s result: %v", action, err)
	}
	return data, nil
}

// CallAsViewed calls an action the app offered (or explained) from an
// entity's view: when the view said no, the API must refuse with the same
// message, so the app never shows an action the API won't take.
func (w *World) CallAsViewed(t *rapid.T, action string, payload any, viewed statemodel.Verdict) {
	t.Helper()
	_, refused := w.Call(t, action, payload, false)
	if !viewed.OK && (refused == nil || refused.Message != viewed.Why) {
		t.Fatalf("%s: the view said %q, the API said %v", action, viewed.Why, refused)
	}
}

func outcome(res router.Response) string {
	if res.Error != nil {
		return fmt.Sprintf("refused %s: %s", res.Error.Code, res.Error.Message)
	}
	return "ok"
}

// snapshot is everything stored, as JSON per part, to tell whether an
// action changed anything.
type snapshot map[string][]byte

func (w *World) snapshot() snapshot {
	parts := map[string]any{
		"clients": w.Store.ClientMap, "sessions": w.Store.SessionMap, "notes": w.Store.NotesMap,
		"followUps": w.Store.FollowUpMap, "packages": w.Store.PackageMap, "settings": w.Store.SettingsVal,
		"documents": w.Docs.Docs, "revisions": w.Docs.Revs, "counters": w.Docs.Counters, "shares": w.Docs.SharesMap,
		"calendar": [][]calendar.Event{w.Calendar.Live, w.Calendar.Trash}, "contacts": w.Contacts.People,
	}
	s := snapshot{}
	for name, v := range parts {
		b, _ := json.Marshal(v)
		s[name] = b
	}
	return s
}

func (s snapshot) equal(other snapshot) bool { return len(s.diff(other)) == 0 }

func (s snapshot) diff(other snapshot) []string {
	var changed []string
	for name, b := range s {
		if !bytes.Equal(b, other[name]) {
			changed = append(changed, name)
		}
	}
	slices.Sort(changed)
	return changed
}

// clone copies the stores, so a check can run a sync or reconcile without
// touching the world.
func (w *World) clone(t *rapid.T) (*memory.Store, app.App) {
	t.Helper()
	m := memory.New()
	b, err := json.Marshal(w.Store)
	if err == nil {
		err = json.Unmarshal(b, m)
	}
	if err != nil {
		t.Fatalf("clone: %v", err)
	}
	m.Writes = 0
	return m, app.New(w.deps(m, memdocs.New(m)))
}

// syncStatus keeps the last sync run in memory.
type syncStatus struct{ last *googlesync.Run }

func (s *syncStatus) Put(_ context.Context, run googlesync.Run) error {
	s.last = &run
	return nil
}

func (s *syncStatus) Get(context.Context) (*googlesync.Run, error) { return s.last, nil }

// fullReconcile re-derives every session, package and client.
var fullReconcile = billing.Scope{AllClients: true, Unmatched: true}

type seedClient struct {
	ID, Name        string
	DefaultFeeCents *int64
	HomeVisits      bool
}

func contactsPerson(c seedClient) contacts.Person {
	return contacts.Person{ResourceName: "people/" + c.ID, ETag: "1", DisplayName: c.Name, Phone: "012 345 6789"}
}

func cents(v int64) *int64 { return &v }

var seedClients = []seedClient{
	{ID: "jane", Name: "Jane Smith", DefaultFeeCents: cents(9000)},
	{ID: "bob", Name: "Bob Lee"},
	{ID: "amy", Name: "Amy Tan", DefaultFeeCents: cents(12000), HomeVisits: true},
}

var seedEvents = []struct {
	offset time.Duration
	title  string
}{
	{-6 * 24 * time.Hour, "Jane Smith 95 10x85"},
	{-2 * 24 * time.Hour, "Bob Lee 120"},
	{-24 * time.Hour, "Jane Smith"},
	{-3 * time.Hour, "Amy Tan"},
	{26 * time.Hour, "? Amy Tan"},
	{50 * time.Hour, "Jane Smith"},
}

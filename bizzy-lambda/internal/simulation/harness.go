// Package simulation drives the whole backend the way the app and the
// outside world do, in random order, and checks after every step that the
// state still makes sense.
//
// The world is the production wiring (internal/app) over in-memory stores,
// a fake calendar, fake contacts and a clock. Actions come from four actors
// (actions_*.go): the user calling the router with JSON as the app does,
// the calendar and contacts changing underneath, and time passing. The
// checks (checks.go) are the entities' rule tables (statemodel) and the
// book's invariants, plus that a refused action changes nothing, the stored
// copies match a fresh derivation, the calendar shows bizzy as it is, the
// app never brings on a conflict, and an edit made in the calendar does
// what the same edit in the app does.
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
	"bizzy-lambda/internal/testutil/memblob"
	"bizzy-lambda/internal/testutil/memory"
)

// The business runs in Kuala Lumpur; the clock starts on a Tuesday morning.
var (
	kl    = time.FixedZone("MYT", 8*60*60)
	epoch = time.Date(2026, 10, 13, 1, 0, 0, 0, time.UTC)
)

type World struct {
	Store    *memory.Store
	Blobs    *memblob.Store
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
	// crashAt counts down the writes to the one the process dies before (see
	// faultActions); 0 when no crash is due.
	crashAt int
	// loseResponse makes the next request do everything, but its answer
	// never arrives, as when the connection drops at the end.
	loseResponse bool
	// retry makes the user tap again, with the same request, when one
	// fails that way.
	retry bool
	// retried says the last call was tapped again, after one that may
	// have done everything: what she saw before is not held to it.
	retried bool
	// unhealed says a request died partway since the last sync, which
	// repairs after it (internal/features/recovery): until then the stores
	// may be half changed.
	unhealed bool
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
		Blobs:    memblob.New(),
		Calendar: &fakecal.Calendar{},
		Contacts: &fakecontacts.Directory{},
		Now:      epoch,
		status:   &syncStatus{},

		pendingSeen: map[string]bool{},
	}
	ids := 0
	dynamo.NewID = func() string {
		ids++
		return fmt.Sprintf("id%03d", ids)
	}
	w.Store.SettingsVal = settings.Settings{BusinessName: "Physio Co", ServiceName: "Physiotherapy"}

	for _, c := range seedClients {
		person := contactsPerson(c)
		w.Contacts.People = append(w.Contacts.People, person)
		link := person.Link(epoch)
		w.Store.ClientMap[c.ID] = clients.Client{
			ID: c.ID, Name: c.Name, Aliases: []string{clients.NormalizeAlias(c.Name)},
			Contact: &link, FeeRates: c.FeeRates, HomeVisits: c.HomeVisits,
		}
	}
	for i, e := range seedEvents {
		start := epoch.Add(e.offset)
		w.Calendar.Live = append(w.Calendar.Live, calendar.Event{
			ID: fmt.Sprintf("seed%d", i+1), Title: e.title, Start: start, End: start.Add(time.Hour), ETag: "1",
		})
	}

	w.Store.OnWrite(w.beforeWrite)
	w.Calendar.OnWrite(w.beforeWrite)
	w.Contacts.OnWrite(w.beforeWrite)
	w.Blobs.OnWrite(w.beforeWrite)
	w.App = app.New(w.deps(w.Store, w.Blobs))
	if _, err := w.App.Sync(context.Background(), googlesync.Range{}); err != nil {
		t.Fatalf("seed sync: %v", err)
	}
	w.InSync = true
	return w
}

func (w *World) deps(m *memory.Store, blobs *memblob.Store) app.Deps {
	return app.Deps{
		Clients: m.Clients(), Sessions: m.Sessions(), FollowUps: m.FollowUps(), Packages: m.Packages(),
		Settings: m.Settings(), Documents: m.Documents(), Conflicts: m.Conflicts(), Book: m.Book(), SyncStatus: w.status,
		Attachments: m.Attachments(), Blobs: blobs, Expenses: m.Expenses(),
		Calendar:  func(context.Context) (googlesync.Calendar, error) { return w.Calendar, nil },
		Directory: w.Contacts,
		Location:  kl,
		Now:       func() time.Time { return w.Now },
		// One request at a time: an entry left behind is one that died.
		Journal: m.Journal(), StaleAfter: 0,
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
	w.retried = false
	before := w.snapshot()
	res, err, died := w.handle(action, body)
	if err != nil {
		t.Fatalf("%s: %v", action, err)
	}
	lost := died == nil && w.loseResponse
	if died != nil || lost {
		w.loseResponse = false
		if died != nil {
			// Whatever was written before stays; Google and the stores may
			// now disagree until the next sync repairs it.
			t.Logf("%s %s → crashed before %s", action, body, died.op)
			outsideChange(w)
			w.unhealed = true
		} else {
			t.Logf("%s %s → %s, but the answer was lost", action, body, outcome(res))
		}
		if w.retry {
			w.retry, w.retried = false, true
			t.Logf("she taps again")
			data, refused := w.Call(t, action, payload, true)
			w.retried = true
			return data, refused
		}
		return nil, &router.ErrorBody{Code: "crashed", Message: "The connection dropped."}
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

// crash is what a write panics with when the process is to die before it.
type crash struct{ op string }

// beforeWrite runs before every write to Google, the stores and blob
// storage, and dies before the one crashAt counted down to.
func (w *World) beforeWrite(op string) {
	if w.crashAt == 0 {
		return
	}
	w.crashAt--
	if w.crashAt == 0 {
		panic(crash{op})
	}
}

// handle runs an action through the router, and reports a crash rather
// than the panic that stopped it.
func (w *World) handle(action string, body []byte) (res router.Response, err error, died *crash) {
	defer func() {
		if r := recover(); r != nil {
			c, ok := r.(crash)
			if !ok {
				panic(r)
			}
			died = &c
		}
	}()
	res, err = w.App.Router.Handle(context.Background(), router.Request{Action: action, Payload: body})
	return res, err, nil
}

// CallAsViewed calls an action the app offered (or explained) from an
// entity's view: when the view said no, the API must refuse with the same
// message, so the app never shows an action the API won't take.
func (w *World) CallAsViewed(t *rapid.T, action string, payload any, viewed statemodel.Verdict) {
	t.Helper()
	_, refused := w.Call(t, action, payload, false)
	w.asViewed(t, action, refused, viewed, false)
}

// asViewed checks the API answered an action as the view said it would:
// refused with the same message and remedies when the view said no, and
// taken when it said yes. A stale view (the calendar changed since the last
// sync) is not held to it.
func (w *World) asViewed(t *rapid.T, action string, refused *router.ErrorBody, viewed statemodel.Verdict, stale bool) {
	t.Helper()
	if stale || w.retried || (refused != nil && refused.Code == "crashed") {
		return
	}
	switch {
	case !viewed.OK && (refused == nil || refused.Message != viewed.Why || refused.Guard != viewed.Guard):
		t.Fatalf("%s: the view said %q (%s), the API said %+v", action, viewed.Why, viewed.Guard, refused)
	case viewed.OK && refused != nil && refused.Guard != "":
		t.Fatalf("%s: the view said yes, the API's %s refused: %s", action, refused.Guard, refused.Message)
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
		"documents": w.Store.Docs, "revisions": w.Store.Revs, "counters": w.Store.Counters, "shares": w.Store.SharesMap,
		"conflicts": w.Store.ConflictMap, "externals": w.Store.ExternalMap,
		"attachments": w.Store.AttachmentMap, "files": w.Blobs.Blobs,
		"expenses": w.Store.ExpenseMap, "items": w.Store.ItemMap, "categories": w.Store.CategoryList,
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

// fork copies the whole world, Google and the files included, so a check
// can sync or reconcile it without touching the world. Nothing in it
// crashes.
func (w *World) fork(t *rapid.T) *World {
	t.Helper()
	f := &World{
		Store: memory.New(), Blobs: memblob.New(), Calendar: &fakecal.Calendar{}, Contacts: &fakecontacts.Directory{},
		Now: w.Now, InSync: w.InSync, status: &syncStatus{last: w.status.last}, pendingSeen: map[string]bool{},
	}
	for _, part := range [][2]any{{w.Store, f.Store}, {w.Blobs, f.Blobs}, {w.Calendar, f.Calendar}, {w.Contacts, f.Contacts}} {
		b, err := json.Marshal(part[0])
		if err == nil {
			err = json.Unmarshal(b, part[1])
		}
		if err != nil {
			t.Fatalf("fork: %v", err)
		}
	}
	f.Store.Writes = 0
	f.App = app.New(f.deps(f.Store, f.Blobs))
	return f
}

// syncStatus keeps the last sync run in memory.
type syncStatus struct{ last *googlesync.Run }

func (s *syncStatus) Put(_ context.Context, run googlesync.Run) error {
	s.last = &run
	return nil
}

func (s *syncStatus) Get(context.Context) (*googlesync.Run, error) { return s.last, nil }

type seedClient struct {
	ID, Name   string
	FeeRates   []clients.FeeRate
	HomeVisits bool
}

func contactsPerson(c seedClient) contacts.Person {
	return contacts.Person{ResourceName: "people/" + c.ID, ETag: "1", DisplayName: c.Name, Phone: "012 345 6789"}
}

func cents(v int64) *int64 { return &v }

var seedClients = []seedClient{
	{ID: "jane", Name: "Jane Smith", FeeRates: []clients.FeeRate{{Cents: 9000}}},
	{ID: "bob", Name: "Bob Lee"},
	// Amy's fee went up the day before the clock starts.
	{ID: "amy", Name: "Amy Tan", FeeRates: []clients.FeeRate{{Cents: 12000}, {From: "2026-10-12", Cents: 13000}}, HomeVisits: true},
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

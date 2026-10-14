package googlesync_test

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"testing"
	"time"

	"bizzy-lambda/internal/app"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/router"
	"bizzy-lambda/internal/testutil/fakecal"
	"bizzy-lambda/internal/testutil/fakecontacts"
	"bizzy-lambda/internal/testutil/memblob"
	"bizzy-lambda/internal/testutil/memory"
)

// These drive the whole app (the same wiring as the Lambda) over in-memory
// stores and a fake calendar: she edits the calendar, the sync reads it,
// and the app's own actions write it back.

var (
	kl  = time.FixedZone("MYT", 8*60*60)
	now = time.Date(2026, 10, 13, 2, 0, 0, 0, time.UTC)
)

type fixture struct {
	t     *testing.T
	store *memory.Store
	cal   *fakecal.Calendar
	app   app.App
	ids   int
	added int
}

type status struct{ last *googlesync.Run }

func (s *status) Put(_ context.Context, r googlesync.Run) error { s.last = &r; return nil }
func (s *status) Get(context.Context) (*googlesync.Run, error)  { return s.last, nil }

// newFixture has Jane, at her place as a rule, and Bob, usually a home
// visit.
func newFixture(t *testing.T) *fixture {
	f := &fixture{t: t, store: memory.New(), cal: &fakecal.Calendar{}}
	f.store.SettingsVal = settings.Settings{BusinessName: "Physio Co", ServiceName: "Physiotherapy"}
	f.store.ClientMap["jane"] = clients.Client{ID: "jane", Name: "Jane Smith", Aliases: []string{"jane smith"}, FeeRates: []clients.FeeRate{{Cents: 9000}}}
	f.store.ClientMap["bob"] = clients.Client{ID: "bob", Name: "Bob Lee", Aliases: []string{"bob lee"}, FeeRates: []clients.FeeRate{{Cents: 12000}}, HomeVisits: true}
	m := f.store
	f.app = app.New(app.Deps{
		Clients: m.Clients(), Sessions: m.Sessions(), FollowUps: m.FollowUps(), Packages: m.Packages(),
		Settings: m.Settings(), Documents: m.Documents(), Conflicts: m.Conflicts(), Book: m.Book(), SyncStatus: &status{},
		Attachments: m.Attachments(), Blobs: memblob.New(), Expenses: m.Expenses(), Journal: m.Journal(),
		Calendar:  func(context.Context) (googlesync.Calendar, error) { return f.cal, nil },
		Directory: &fakecontacts.Directory{},
		Location:  kl,
		Now:       func() time.Time { return now },
		NewID:     func() string { f.ids++; return fmt.Sprintf("id%03d", f.ids) },
	})
	return f
}

// at is a time on the day after now, in her time zone.
func at(hour, minute int) time.Time {
	return time.Date(2026, 10, 14, hour, minute, 0, 0, kl).UTC()
}

// add is an event she makes in the calendar, an hour long.
func (f *fixture) add(title string, start time.Time) string {
	f.added++
	id := fmt.Sprintf("ev%d", f.added)
	f.cal.Live = append(f.cal.Live, calendar.Event{ID: id, Title: title, Start: start, End: start.Add(time.Hour), ETag: "1"})
	return id
}

// edit changes an event as she would in Google Calendar.
func (f *fixture) edit(id string, change func(e *calendar.Event)) {
	i := f.cal.Find(id)
	if i < 0 {
		f.t.Fatalf("no event %s", id)
	}
	change(&f.cal.Live[i])
	f.cal.Live[i].ETag += "+"
}

func (f *fixture) sync() {
	f.t.Helper()
	if _, err := f.app.Sync(context.Background(), googlesync.Range{}); err != nil {
		f.t.Fatalf("sync: %v", err)
	}
}

// call sends an action as the app does, failing on an internal error.
func (f *fixture) call(action string, payload any) (json.RawMessage, *router.ErrorBody) {
	f.t.Helper()
	body, _ := json.Marshal(payload)
	res, err := f.app.Router.Handle(context.Background(), router.Request{Action: action, Payload: body})
	if err != nil || (res.Error != nil && res.Error.Code == "internal") {
		f.t.Fatalf("%s: %v %+v", action, err, res.Error)
	}
	data, _ := json.Marshal(res.Data)
	return data, res.Error
}

func (f *fixture) ok(action string, payload any) json.RawMessage {
	f.t.Helper()
	data, refused := f.call(action, payload)
	if refused != nil {
		f.t.Fatalf("%s refused: %s", action, refused.Message)
	}
	return data
}

// shown is what an event shows.
func (f *fixture) shown(eventID string) conflicts.External {
	return f.store.ExternalMap[conflicts.Key(conflicts.SurfaceCalendar, eventID)]
}

func (f *fixture) session(eventID string) sessions.Session {
	f.t.Helper()
	s, ok := f.store.SessionMap[f.shown(eventID).ID]
	if !ok {
		f.t.Fatalf("event %s shows no session", eventID)
	}
	return s
}

func (f *fixture) conflict(eventID string) (conflicts.Conflict, bool) {
	c, ok := f.store.ConflictMap[conflicts.Key(conflicts.SurfaceCalendar, eventID)]
	return c, ok
}

func (f *fixture) title(eventID string) string {
	return f.cal.Live[f.cal.Find(eventID)].Title
}

func guards(c conflicts.Conflict) []string {
	var out []string
	for _, v := range c.Violations {
		out = append(out, v.Guard)
	}
	return out
}

func TestPlaceIsInTheTitle(t *testing.T) {
	f := newFixture(t)
	visit := f.add("Jane Smith (V)", at(9, 0))
	usual := f.add("Bob Lee", at(11, 0))
	home := f.add("Bob Lee (h) 100", at(13, 0))
	f.sync()

	for _, c := range []struct {
		event string
		want  sessions.Location
		title string
	}{
		{visit, sessions.LocationVisit, "Jane Smith (V)"},
		{usual, sessions.LocationVisit, "Bob Lee"},
		{home, sessions.LocationOwn, "Bob Lee (H) 100"},
	} {
		if s := f.session(c.event); s.Location != c.want {
			t.Errorf("%s: location %s, want %s", c.event, s.Location, c.want)
		}
		if got := f.title(c.event); got != c.title {
			t.Errorf("%s: title %q, want %q", c.event, got, c.title)
		}
	}

	// A colour is hers: bizzy reads nothing from it.
	before := maps.Clone(f.store.SessionMap)
	f.edit(visit, func(e *calendar.Event) { e.ColorID = "11" })
	f.sync()
	for id, s := range f.store.SessionMap {
		if s.Location != before[id].Location || s.Version != before[id].Version {
			t.Errorf("a colour changed session %s", id)
		}
	}

	// Bob no longer usually visited: his visit says so in its title now.
	bob := f.store.ClientMap["bob"]
	f.ok("clients.save", map[string]any{"id": "bob", "name": bob.Name, "aliases": bob.Aliases, "feeRates": bob.FeeRates, "homeVisits": false})
	if got := f.title(usual); got != "Bob Lee (V)" {
		t.Errorf("title %q, want the visit marked", got)
	}
	if got := f.title(home); got != "Bob Lee 100" {
		t.Errorf("title %q, want her place unmarked as his usual now", got)
	}
}

func TestSessionsNeverOverlap(t *testing.T) {
	f := newFixture(t)
	jane := f.add("Jane Smith", at(10, 0))
	f.sync()

	clash := f.add("Bob Lee", at(10, 30))
	f.sync()
	c, waiting := f.conflict(clash)
	if !waiting || guards(c)[0] != "sessions-never-overlap" {
		t.Fatalf("an overlapping event: conflict %+v", c)
	}
	_, refused := f.call("sessions.create", map[string]any{"clientId": "bob", "start": at(10, 30)})
	if refused == nil || refused.Guard != "sessions-never-overlap" {
		t.Fatalf("the app booked over Jane's session: %+v", refused)
	}

	// Back to back is fine; moving it there settles the conflict.
	f.edit(clash, func(e *calendar.Event) { e.Start, e.End = at(11, 0), at(12, 0) })
	f.sync()
	if _, waiting := f.conflict(clash); waiting || f.session(clash).ClientID != "bob" {
		t.Fatal("the moved event should be Bob's session")
	}
	// Moving Jane's onto Bob's waits too.
	f.edit(jane, func(e *calendar.Event) { e.Start, e.End = at(11, 15), at(12, 15) })
	f.sync()
	if c, waiting := f.conflict(jane); !waiting || guards(c)[0] != "sessions-never-overlap" || !f.session(jane).Start.Equal(at(10, 0)) {
		t.Fatalf("moving onto another session: %+v", c)
	}
}

func TestDuplicatedEventIsANewSession(t *testing.T) {
	f := newFixture(t)
	// Booked in the app, so its event carries the session's id.
	f.ok("sessions.create", map[string]any{"clientId": "jane", "start": at(10, 0), "feeCents": 9500})
	var s sessions.Session
	for _, s = range f.store.SessionMap {
	}
	original := s.Event.EventID

	// Google's Duplicate copies bizzy's private property too.
	copied := f.cal.Live[f.cal.Find(original)]
	copied.ID, copied.Start, copied.End = "copy", copied.Start.AddDate(0, 0, 7), copied.End.AddDate(0, 0, 7)
	copied.Private = maps.Clone(copied.Private)
	if copied.Private[calendar.PropSession] != s.ID {
		t.Fatalf("the original carries %v", copied.Private)
	}
	f.cal.Live = append(f.cal.Live, copied)
	f.sync()

	if got := f.session("copy"); got.ID == s.ID || got.FeeCents != 9500 || !got.Start.Equal(at(10, 0).AddDate(0, 0, 7)) {
		t.Errorf("the copy shows %+v", got)
	}
	if got := f.session(original); got.ID != s.ID || !got.Start.Equal(s.Start) {
		t.Errorf("the original now shows %+v", got)
	}

	// A copy left at the same time would overlap it.
	again := f.cal.Live[f.cal.Find(original)]
	again.ID = "copy2"
	f.cal.Live = append(f.cal.Live, again)
	f.sync()
	if c, waiting := f.conflict("copy2"); !waiting || guards(c)[0] != "sessions-never-overlap" {
		t.Errorf("a copy over its original: %+v", c)
	}
}

func TestWaitingEditWaitsToBeApplied(t *testing.T) {
	f := newFixture(t)
	ev := f.add("Jane Smith", at(10, 0))
	f.sync()
	s := f.session(ev)
	inv := f.store.Docs[s.Invoice.DocumentID]
	f.ok("documents.issue", map[string]any{"id": inv.ID, "version": inv.Version})

	// She gives the session to Bob in the calendar: the issued invoice
	// says Jane.
	f.edit(ev, func(e *calendar.Event) { e.Title = "Bob Lee" })
	f.sync()
	c, waiting := f.conflict(ev)
	if !waiting || guards(c)[0] != "issued-documents-never-change" {
		t.Fatalf("conflict %+v", c)
	}

	// Cancelling the invoice from the documents page, for whatever reason,
	// lets the edit through, but doesn't apply it: it waits, ready.
	inv = f.store.Docs[inv.ID]
	f.ok("documents.cancel", map[string]any{"id": inv.ID, "version": inv.Version, "reason": "Wrong amount"})
	f.sync()
	c, waiting = f.conflict(ev)
	if !waiting || len(c.Violations) != 0 || c.View().Rules[0] != "edit-ready" {
		t.Fatalf("the edit should be ready to apply: %+v", c)
	}
	if f.session(ev).ClientID != "jane" {
		t.Fatal("a ready edit applied by itself")
	}

	f.ok("conflicts.apply", map[string]any{"key": c.Key})
	if _, waiting := f.conflict(ev); waiting || f.session(ev).ClientID != "bob" {
		t.Fatal("applying it should give the session to Bob")
	}
}

func TestSwappedEventsApplyInOneSync(t *testing.T) {
	f := newFixture(t)
	first := f.add("Jane Smith", at(10, 0))
	second := f.add("Bob Lee", at(11, 0))
	f.sync()

	f.edit(first, func(e *calendar.Event) { e.Start, e.End = at(11, 0), at(12, 0) })
	f.edit(second, func(e *calendar.Event) { e.Start, e.End = at(10, 0), at(11, 0) })
	f.sync()
	if len(f.store.ConflictMap) > 0 {
		t.Fatalf("conflicts left: %v", f.store.ConflictMap)
	}
	if !f.session(first).Start.Equal(at(11, 0)) || !f.session(second).Start.Equal(at(10, 0)) {
		t.Error("the two sessions should have swapped")
	}
}

func TestFollowUpsAreReadAndWritten(t *testing.T) {
	f := newFixture(t)
	f.cal.Live = append(f.cal.Live, calendar.Event{ID: "fu", Title: "! Jane Smith: call back", AllDay: true, Date: "2026-10-20", Description: "About the knee", ETag: "1"})
	f.sync()
	fu, ok := f.store.FollowUpMap[f.shown("fu").ID]
	if !ok || fu.ClientID != "jane" || fu.Summary != "call back" || fu.Notes != "About the knee" || !fu.AllDay || fu.Date(kl) != "2026-10-20" {
		t.Fatalf("follow-up %+v", fu)
	}

	// Her edits there apply; the app's are written there.
	f.edit("fu", func(e *calendar.Event) { e.Description = "Ask about the scan" })
	f.sync()
	if fu = f.store.FollowUpMap[fu.ID]; fu.Notes != "Ask about the scan" {
		t.Errorf("notes %q", fu.Notes)
	}
	f.ok("followUps.update", map[string]any{"id": fu.ID, "clientId": "jane", "date": "2026-10-21", "summary": "send exercises", "notes": "Band, 3 sets"})
	e := f.cal.Live[f.cal.Find("fu")]
	if e.Title != "! Jane Smith: send exercises" || e.Date != "2026-10-21" || e.Description != "Band, 3 sets" {
		t.Errorf("event %+v", e)
	}
	f.ok("followUps.setDone", map[string]any{"id": fu.ID, "done": true})
	if fu = f.store.FollowUpMap[fu.ID]; fu.DoneAt == nil {
		t.Error("not done")
	}

	// A name no client has waits, and applies once a client has it.
	f.cal.Live = append(f.cal.Live, calendar.Event{ID: "who", Title: "! JS: hi", Start: at(9, 0), End: at(9, 15), ETag: "1"})
	f.sync()
	if c, waiting := f.conflict("who"); !waiting || guards(c)[0] != "name-is-a-client" {
		t.Fatalf("conflict %+v", c)
	}
	jane := f.store.ClientMap["jane"]
	f.ok("clients.save", map[string]any{"id": "jane", "name": jane.Name, "aliases": []string{"jane smith", "js"}, "feeRates": jane.FeeRates})
	if _, waiting := f.conflict("who"); waiting || f.store.FollowUpMap[f.shown("who").ID].ClientID != "jane" {
		t.Error("the new event should apply once Jane is called JS")
	}

	// Made in the app: written to the calendar with its notes.
	data := f.ok("followUps.create", map[string]any{"clientId": "bob", "start": at(16, 0), "summary": "check in", "notes": "Ring after 4"})
	var made followups.FollowUp
	_ = json.Unmarshal(data, &made)
	made = f.store.FollowUpMap[made.ID]
	written := f.cal.Live[f.cal.Find(made.Event.EventID)]
	if written.Title != "! Bob Lee: check in" || written.Description != "Ring after 4" || written.Private[calendar.PropFollowUp] != made.ID {
		t.Errorf("written %+v", written)
	}

	// Deleting its event deletes it.
	f.edit("fu", func(e *calendar.Event) { e.Cancelled = true })
	f.sync()
	if _, ok := f.store.FollowUpMap[fu.ID]; ok {
		t.Error("the follow-up should go with its event")
	}
}

func TestEventsKeepTheirKind(t *testing.T) {
	f := newFixture(t)
	ev := f.add("Jane Smith", at(10, 0))
	f.sync()
	f.edit(ev, func(e *calendar.Event) { e.Title = "! Jane Smith: call" })
	f.sync()
	c, waiting := f.conflict(ev)
	if !waiting || guards(c)[0] != "calendar-title-readable" {
		t.Fatalf("a session's event retitled as a follow-up: %+v", c)
	}
	f.ok("calendar.revert", map[string]any{"key": c.Key})
	if got := f.title(ev); got != "Jane Smith" {
		t.Errorf("reverted title %q", got)
	}
	if _, waiting := f.conflict(ev); waiting {
		t.Error("reverting settles it")
	}
}

func TestSoldPackageKeepsItsSize(t *testing.T) {
	f := newFixture(t)
	f.ok("packages.save", map[string]any{"clientId": "jane", "sessions": 10, "priceCents": 85000, "purchasedAt": now})
	var pkgID string
	for id := range f.store.PackageMap {
		pkgID = id
	}
	line := func() documents.Line {
		p := f.store.PackageMap[pkgID]
		d := f.store.Docs[p.Invoice.DocumentID]
		if d.Draft != nil {
			return d.Draft.Lines[0]
		}
		return d.Content.Lines[0]
	}

	// On a draft, the line says the new size.
	f.ok("packages.save", map[string]any{"id": pkgID, "clientId": "jane", "sessions": 12, "priceCents": 85000, "purchasedAt": now})
	if got := line().Description; got != "Physiotherapy package (12 sessions)" {
		t.Errorf("description %q", got)
	}

	// Once issued, it was sold as 12.
	d := f.store.Docs[f.store.PackageMap[pkgID].Invoice.DocumentID]
	f.ok("documents.issue", map[string]any{"id": d.ID, "version": d.Version})
	_, refused := f.call("packages.save", map[string]any{"id": pkgID, "clientId": "jane", "sessions": 5, "priceCents": 85000, "purchasedAt": now})
	if refused == nil || refused.Guard != "sold-packages-keep-their-size" || len(refused.Remedies) != 1 || refused.Remedies[0].Action != "documents.cancel" {
		t.Fatalf("refused %+v", refused)
	}
	if f.store.PackageMap[pkgID].Sessions != 12 {
		t.Error("a refused change changed the package")
	}
}

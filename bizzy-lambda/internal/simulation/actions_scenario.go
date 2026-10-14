package simulation

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/features/book"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/features/sessions"
)

// scenarioActions are the user's steps that only matter together, done in
// one go so that runs reach their outcome often, and checks that compare
// two ways of doing one thing.
var scenarioActions = []Action{
	// Only an issued document can be contradicted: issue one often.
	{Name: "scenario.issueDocument", Actor: ActorScenario, Run: func(t *rapid.T, w *World) {
		d := pickDocument(t, w, func(d documents.Document) bool { return d.Status == documents.StatusDraft })
		w.Call(t, "documents.issue", map[string]any{"id": d.ID, "version": d.Version}, true)
	}},
	{Name: "scenario.calendarVsApp", Actor: ActorScenario, Run: calendarVsApp},
}

// calendarVsApp: an edit to a session made in the calendar does what the
// same edit made in the app does. Both are tried on copies of the world: in
// one, the session's event is changed to say the new booking and the
// calendar is synced; in the other, the app saves the booking. Either both
// are applied, leaving the same sessions, packages and documents, or both
// refused, the calendar's kept as a conflict whose first refusal is the
// app's. The calendar can do exactly what the app can, and nothing else.
func calendarVsApp(t *rapid.T, w *World) {
	if !w.InSync || w.unhealed {
		t.Skip("the calendar must be as bizzy last left it")
	}
	s := pickSession(t, w, func(s sessions.Session) bool {
		_, waiting := w.Store.ConflictMap[conflicts.Key(conflicts.SurfaceCalendar, s.Event.EventID)]
		return s.Event.EventID != "" && !waiting && w.Calendar.Find(s.Event.EventID) >= 0
	})
	data, refused := w.Call(t, "sessions.get", map[string]any{"id": s.ID}, false)
	if refused != nil {
		t.Fatalf("sessions.get: %s", refused.Message)
	}
	var stored book.Stored
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatalf("sessions.get result: %v", err)
	}

	// The edit, as the form would have it.
	d := stored.Draft
	if rapid.Bool().Draw(t, "move it?") {
		d.Start = d.Start.Add(time.Duration(rapid.SampledFrom([]int{-48, -3, 2, 24}).Draw(t, "hours moved")) * time.Hour)
	}
	if rapid.IntRange(0, 3).Draw(t, "toggle tentative?") == 0 {
		d.Tentative = !d.Tentative
	}
	if rapid.IntRange(0, 2).Draw(t, "another client?") == 0 {
		var writable []string
		for _, id := range slices.Sorted(maps.Keys(w.Store.ClientMap)) {
			if book.Writable(w.Store.ClientMap[id].Name) {
				writable = append(writable, id)
			}
		}
		d.ClientID = rapid.SampledFrom(writable).Draw(t, "client")
	}
	if rapid.Bool().Draw(t, "change the fee?") {
		d.FeeCents = rapid.SampledFrom([]*int64{nil, cents(0), cents(9500), cents(12000)}).Draw(t, "fee")
	}
	if rapid.IntRange(0, 3).Draw(t, "change the package?") == 0 {
		d.Package = rapid.SampledFrom([]*book.PackageSpec{nil, {Sessions: 2, PriceCents: 17000}, {Sessions: 3, PriceCents: 25000}}).Draw(t, "package")
	}
	if rapid.IntRange(0, 3).Draw(t, "toggle home visit?") == 0 {
		d.HomeVisit = !d.HomeVisit
	}
	t.Logf("calendar vs app: session %s becomes %s", s.ID, toJSON(d))

	// In the app.
	app := w.fork(t)
	_, appRefused := app.Call(t, "sessions.update", with(asMap(t, d), map[string]any{"id": s.ID}), true)

	// In the calendar.
	cal := w.fork(t)
	client := w.Store.ClientMap[d.ClientID]
	name := client.Name
	if d.ClientID == s.ClientID {
		name = book.WrittenName(client, s.Event.Seen)
	}
	location := sessions.LocationOwn
	if d.HomeVisit {
		location = sessions.LocationVisit
	}
	title := calendar.Title{Tentative: d.Tentative, Name: name, FeeCents: d.FeeCents, Place: book.PlaceFor(location, client.HomeVisits)}
	if p := d.Package; p != nil {
		title.Package = &calendar.PackageSpec{Sessions: p.Sessions, PriceCents: p.PriceCents}
	}
	minutes := d.Minutes
	if minutes == 0 {
		minutes = 60
	}
	e := &cal.Calendar.Live[cal.Calendar.Find(s.Event.EventID)]
	e.Title = calendar.FormatTitle(title)
	e.Start, e.End = d.Start.UTC(), d.Start.UTC().Add(time.Duration(minutes)*time.Minute)
	touched(e)
	t.Logf("calendar vs app: the event says %q at %s", e.Title, e.Start.Format(time.RFC3339))
	if _, err := cal.App.Sync(context.Background(), googlesync.Range{}); err != nil {
		t.Fatalf("sync: %v", err)
	}
	conflict, calRefused := cal.Store.ConflictMap[conflicts.Key(conflicts.SurfaceCalendar, e.ID)]

	switch {
	case appRefused != nil && appRefused.Guard == "":
		t.Fatalf("the app refused the edit as invalid input: %s", appRefused.Message)
	case (appRefused != nil) != calRefused:
		t.Fatalf("the app %s the edit, but the calendar %s it (conflict: %+v)", verb(appRefused != nil), verb(calRefused), conflict.Violations)
	case calRefused && conflict.Violations[0].Guard != appRefused.Guard:
		t.Fatalf("the app's %s refused the edit, the calendar's %s", appRefused.Guard, conflict.Violations[0].Guard)
	case !calRefused:
		if a, c := essentials(app), essentials(cal); a != c {
			t.Fatalf("the edit left, from the app:\n%s\nfrom the calendar:\n%s", a, c)
		}
	}
}

func verb(refused bool) string {
	if refused {
		return "refused"
	}
	return "applied"
}

// essentials are the sessions, packages and documents as the user sees
// them, without the ids and versions two copies of the world give
// differently.
func essentials(w *World) string {
	// A session is named by its event: one an edit lets in (a new event
	// waiting for a slot) takes another id in each world.
	name := func(id string) string {
		if s, ok := w.Store.SessionMap[id]; ok && s.Event.EventID != "" {
			return "of event " + s.Event.EventID
		}
		return id
	}
	pkg := func(id string) string {
		p, ok := w.Store.PackageMap[id]
		if !ok {
			return ""
		}
		return fmt.Sprintf("%s %dx%d bought in %q", p.ClientID, p.Sessions, p.PriceCents, name(p.BoughtIn))
	}
	var lines []string
	for _, id := range slices.Sorted(maps.Keys(w.Store.SessionMap)) {
		s := w.Store.SessionMap[id]
		var paid int64
		if s.Paid != nil {
			paid = s.Paid.AmountCents
		}
		lines = append(lines, fmt.Sprintf("session %s: %s %s–%s tentative=%v %s fee=%d typed=%v credit=[%s] paid=%d bought=[%s] owes=%d invoice=%s receipt=%s",
			name(id), s.ClientID, s.Start.Format(time.RFC3339), s.End.Format(time.RFC3339), s.Tentative, s.Location, s.FeeCents, s.FeeTyped,
			pkg(s.PackageID), paid, pkg(s.BoughtPackageID), s.BoughtOwedCents, sessions.SlotOf(s.Invoice), sessions.SlotOf(s.Receipt)))
	}
	var packages []string
	for id := range w.Store.PackageMap {
		p := w.Store.PackageMap[id]
		packages = append(packages, fmt.Sprintf("package %s used %d", pkg(id), p.CreditsUsed))
	}
	var docs []string
	for _, d := range w.Store.Docs {
		docs = append(docs, fmt.Sprintf("%s %s for %s: %d", d.Status, d.Type, d.ClientID, d.TotalCents))
	}
	slices.Sort(lines)
	slices.Sort(packages)
	slices.Sort(docs)
	return toJSON(slices.Concat(lines, packages, docs))
}

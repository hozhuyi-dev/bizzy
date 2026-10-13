package googlesync

import (
	"cmp"
	"context"
	"errors"
	"time"

	"bizzy-lambda/internal/features/billing"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/router"
)

const defaultMinutes = 60

// Calendar is her sessions calendar, read and written.
type Calendar interface {
	EventSource
	Get(ctx context.Context, id string) (calendar.Event, error)
	Insert(ctx context.Context, in calendar.EventInput) (calendar.Event, error)
	Update(ctx context.Context, id, etag string, in calendar.EventInput) (calendar.Event, error)
	Restore(ctx context.Context, id string) (calendar.Event, error)
	Delete(ctx context.Context, id, etag string) error
}

type SettingsStore interface {
	Get(ctx context.Context) (settings.Settings, error)
}

// EditorSessions is what the editor reads of sessions.
type EditorSessions interface {
	Get(ctx context.Context, eventID string) (sessions.Session, bool, error)
	Notes(ctx context.Context, eventID string) (sessions.Notes, error)
}

// Editor writes the sessions she adds, edits and deletes in the app to the
// calendar, then applies each change exactly as the next sync would, so the
// app shows it at once and the sync finds nothing left to do.
type Editor struct {
	// Calendar opens the calendar she chose in Settings.
	Calendar func(ctx context.Context) (Calendar, error)
	Clients  interface {
		List(ctx context.Context) ([]clients.Client, error)
	}
	Sessions EditorSessions
	Settings SettingsStore
	Billing  Reconciler
	// Now defaults to time.Now.
	Now func() time.Time
}

// Draft is a session as she fills it in. The title is written from it in the
// calendar syntax, so it always parses and matches the client.
type Draft struct {
	ClientID string    `json:"clientId"`
	Start    time.Time `json:"start"`
	// Minutes defaults to an hour.
	Minutes int `json:"minutes"`
	// FeeCents is what the session costs; nil leaves it to a package credit
	// or the client's default fee.
	FeeCents *int64 `json:"feeCents,omitempty"`
	// Package is one bought in this session.
	Package   *DraftPackage `json:"package,omitempty"`
	HomeVisit bool          `json:"homeVisit"`
	Tentative bool          `json:"tentative"`
}

type DraftPackage struct {
	Sessions   int   `json:"sessions"`
	PriceCents int64 `json:"priceCents"`
}

func RegisterEditor(r *router.Router, e Editor) {
	r.Query("sessions.get", router.Typed(e.get))
	r.Mutation("sessions.create", router.Typed(e.create))
	r.Mutation("sessions.update", router.Typed(e.update))
	r.Mutation("sessions.delete", router.Typed(e.delete))
	r.Mutation("sessions.restore", router.Typed(e.restore))
	r.Mutation("sessions.discard", router.Typed(e.discard))
}

type eventInput struct {
	EventID string `json:"eventId"`
}

// Stored is a session with the draft to start an edit from and its notes.
// The title is read here, so the app never parses the syntax itself.
type Stored struct {
	Session sessions.View `json:"session"`
	Draft   Draft         `json:"draft"`
	Notes   string        `json:"notes"`
}

func (e Editor) get(ctx context.Context, in eventInput) (any, error) {
	s, found, err := e.Sessions.Get(ctx, in.EventID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, sessions.ErrGone
	}
	notes, err := e.Sessions.Notes(ctx, in.EventID)
	if err != nil {
		return nil, err
	}
	now := time.Now
	if e.Now != nil {
		now = e.Now
	}
	return Stored{Session: s.View(now()), Draft: draftOf(s), Notes: notes.Text}, nil
}

func draftOf(s sessions.Session) Draft {
	d := Draft{
		ClientID:  cmp.Or(s.ClientID, s.SuggestedClientID),
		Start:     s.Start,
		Minutes:   int(s.End.Sub(s.Start).Minutes()),
		HomeVisit: s.Location == sessions.LocationHome,
	}
	title, err := calendar.ParseTitle(s.Title)
	d.Tentative = title.Tentative
	// An unreadable title's amounts can't be trusted; she enters them again.
	if err == nil {
		d.FeeCents = title.FeeCents
		if p := title.Package; p != nil {
			d.Package = &DraftPackage{Sessions: p.Sessions, PriceCents: p.PriceCents}
		}
	}
	return d
}

// created is what create returns: the new session's event ID, so the app
// can open it.
type created struct {
	EventID string `json:"eventId"`
}

func (e Editor) create(ctx context.Context, d Draft) (any, error) {
	client, err := e.validate(ctx, d)
	if err != nil {
		return nil, err
	}
	in, err := e.eventInput(ctx, d, client, nil)
	if err != nil {
		return nil, err
	}

	cal, err := e.Calendar(ctx)
	if err != nil {
		return nil, err
	}
	event, err := cal.Insert(ctx, in)
	if err != nil {
		return nil, err
	}
	return created{EventID: event.ID}, e.apply(ctx, event.ID, &event, false)
}

type updateInput struct {
	EventID string `json:"eventId"`
	Draft
}

// update rewrites the event: confirming, rescheduling and fixing the title
// are all edits of the draft.
func (e Editor) update(ctx context.Context, in updateInput) (any, error) {
	client, err := e.validate(ctx, in.Draft)
	if err != nil {
		return nil, err
	}
	cal, live, err := e.current(ctx, in.EventID)
	if err != nil {
		return nil, err
	}
	input, err := e.eventInput(ctx, in.Draft, client, &live)
	if err != nil {
		return nil, err
	}

	event, err := cal.Update(ctx, in.EventID, live.ETag, input)
	if err != nil {
		return nil, err
	}
	return nil, e.apply(ctx, in.EventID, &event, false)
}

// delete removes the event from the calendar, and the session with it,
// notes and payment included: she chose to.
func (e Editor) delete(ctx context.Context, in eventInput) (any, error) {
	cal, live, err := e.current(ctx, in.EventID)
	if errors.Is(err, calendar.ErrGone) {
		// Already deleted in the calendar.
		return nil, e.apply(ctx, in.EventID, nil, true)
	}
	if err != nil {
		return nil, err
	}

	if err := cal.Delete(ctx, in.EventID, live.ETag); err != nil && !errors.Is(err, calendar.ErrGone) {
		return nil, err
	}
	return nil, e.apply(ctx, in.EventID, nil, true)
}

// restore brings back a session deleted in the calendar, with its event.
func (e Editor) restore(ctx context.Context, in eventInput) (any, error) {
	if _, err := e.removed(ctx, in.EventID); err != nil {
		return nil, err
	}
	cal, err := e.Calendar(ctx)
	if err != nil {
		return nil, err
	}
	event, err := cal.Restore(ctx, in.EventID)
	if errors.Is(err, calendar.ErrGone) {
		return nil, apperr.Conflict("Google Calendar no longer has this event (deleted events are kept about 30 days). Discard it here, and add the session again if it happened.")
	}
	if err != nil {
		return nil, err
	}
	return nil, e.apply(ctx, in.EventID, &event, false)
}

// discard drops a session deleted in the calendar, with what she recorded.
func (e Editor) discard(ctx context.Context, in eventInput) (any, error) {
	s, err := e.removed(ctx, in.EventID)
	if err != nil {
		return nil, err
	}
	if err := s.CanDiscard(); err != nil {
		return nil, err
	}
	return nil, e.apply(ctx, in.EventID, nil, true)
}

func (e Editor) removed(ctx context.Context, eventID string) (sessions.Session, error) {
	s, found, err := e.Sessions.Get(ctx, eventID)
	switch {
	case err != nil:
		return s, err
	case !found:
		return s, sessions.ErrGone
	}
	return s, s.CanRestore()
}

func (e Editor) validate(ctx context.Context, d Draft) (clients.Client, error) {
	switch {
	case d.ClientID == "":
		return clients.Client{}, apperr.Invalid("choose a client")
	case d.Start.IsZero():
		return clients.Client{}, apperr.Invalid("a session needs a start time")
	case d.Minutes != 0 && (d.Minutes < 5 || d.Minutes > 12*60):
		return clients.Client{}, apperr.Invalid("a session lasts 5 minutes to 12 hours")
	case d.FeeCents != nil && *d.FeeCents < 0:
		return clients.Client{}, apperr.Invalid("the fee can't be negative")
	case d.Package != nil && (d.Package.Sessions < 1 || d.Package.Sessions > 1000):
		return clients.Client{}, apperr.Invalid("a package has 1 to 1000 sessions")
	case d.Package != nil && d.Package.PriceCents <= 0:
		return clients.Client{}, apperr.Invalid("a package needs a price")
	}
	return findClient(ctx, e.Clients, d.ClientID)
}

func findClient(ctx context.Context, store interface {
	List(ctx context.Context) ([]clients.Client, error)
}, id string) (clients.Client, error) {
	all, err := store.List(ctx)
	if err != nil {
		return clients.Client{}, err
	}
	for _, c := range all {
		if c.ID == id {
			return c, nil
		}
	}
	return clients.Client{}, apperr.NotFound("client not found")
}

// current reads the event behind a stored session she is about to change. A
// session with an invoice or receipt can't be changed. If the calendar
// changed since the last sync, the change is applied and the edit refused,
// so she sees the latest before deciding again.
func (e Editor) current(ctx context.Context, eventID string) (Calendar, calendar.Event, error) {
	before, found, err := e.Sessions.Get(ctx, eventID)
	if err != nil {
		return nil, calendar.Event{}, err
	}
	if !found {
		return nil, calendar.Event{}, apperr.NotFound("session not found")
	}
	if err := before.CanEditBooking(); err != nil {
		return nil, calendar.Event{}, err
	}

	cal, err := e.Calendar(ctx)
	if err != nil {
		return nil, calendar.Event{}, err
	}
	live, err := cal.Get(ctx, eventID)
	if errors.Is(err, calendar.ErrGone) || (err == nil && !isSession(live)) {
		if err := e.apply(ctx, eventID, nil, false); err != nil {
			return nil, calendar.Event{}, err
		}
		return nil, calendar.Event{}, calendar.ErrGone
	}
	if err != nil {
		return nil, calendar.Event{}, err
	}
	if calendarChanged(before, live) {
		if err := e.apply(ctx, eventID, &live, false); err != nil {
			return nil, calendar.Event{}, err
		}
		return nil, calendar.Event{}, calendar.ErrChanged
	}
	return cal, live, nil
}

// apply makes the stored session match the event (nil when it is gone) as
// the sync would. discard drops a gone session's notes and payment too.
func (e Editor) apply(ctx context.Context, eventID string, event *calendar.Event, discard bool) error {
	if event != nil && !isSession(*event) {
		event = nil
	}
	change := billing.Change{EventID: eventID, Event: event, Discard: discard}
	_, err := e.Billing.Reconcile(ctx, billing.Scope{Changes: []billing.Change{change}})
	return err
}

// eventInput writes the draft as an event. Editing keeps the name she wrote
// if it still means this client, and the colour if it still says the
// location she chose.
func (e Editor) eventInput(ctx context.Context, d Draft, client clients.Client, existing *calendar.Event) (calendar.EventInput, error) {
	cfg, err := e.Settings.Get(ctx)
	if err != nil {
		return calendar.EventInput{}, err
	}

	name, existingColor := writtenName(client, existing), ""
	if existing != nil {
		existingColor = existing.ColorID
	}

	title := calendar.Title{Tentative: d.Tentative, Name: name, FeeCents: d.FeeCents}
	if d.Package != nil {
		title.Package = &calendar.PackageSpec{Sessions: d.Package.Sessions, PriceCents: d.Package.PriceCents}
	}
	text := calendar.FormatTitle(title)
	// A name ending like an amount would read back as one.
	if parsed, err := calendar.ParseTitle(text); err != nil || parsed.Name != name {
		return calendar.EventInput{}, apperr.Invalid("%q can't be written in a calendar title. Give the client a name that doesn't end in a number.", name)
	}

	minutes := d.Minutes
	if minutes == 0 {
		minutes = defaultMinutes
	}
	start := d.Start.UTC()
	return calendar.EventInput{
		Title:   text,
		Start:   start,
		End:     start.Add(time.Duration(minutes) * time.Minute),
		ColorID: colorFor(d.HomeVisit, client.HomeVisits, cfg.HomeVisitColorID, existingColor),
	}, nil
}

// writtenName is the name to write in a title for the client: the one
// already there if it still means them (she may write "Jane S"), else
// their name.
func writtenName(client clients.Client, existing *calendar.Event) string {
	if existing == nil {
		return client.Name
	}
	aliases := clients.AliasesOf([]clients.Client{client})
	var name string
	if calendar.IsFollowUp(existing.Title) {
		title, err := calendar.ParseFollowUp(existing.Title)
		if err != nil {
			return client.Name
		}
		name = title.Name
	} else {
		title, err := calendar.ParseTitle(existing.Title)
		if err != nil {
			return client.Name
		}
		name = title.Name
	}
	if clients.MatchName(name, aliases).Kind == clients.MatchExact {
		return name
	}
	return client.Name
}

// colorFor picks the event colour that makes the reconcile read the
// location she chose: none when it's the client's usual, the home-visit
// colour for a home visit, and another colour for her place. An existing
// colour that already says the right thing is kept.
func colorFor(home, usuallyHome bool, homeColorID, existing string) string {
	switch {
	case existing != "" && (existing == homeColorID) == home:
		return existing
	case home == usuallyHome:
		return ""
	case home:
		return homeColorID
	case homeColorID == clinicColorID:
		return altClinicColorID
	default:
		return clinicColorID
	}
}

// Google's event colours "1" (Lavender) and "2" (Sage): any colour but the
// home-visit one means her place.
const (
	clinicColorID    = "1"
	altClinicColorID = "2"
)

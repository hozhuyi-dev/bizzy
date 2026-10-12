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

// BookingLookahead is how far ahead next bookings are looked for, so a
// client who has rebooked is not suggested for a follow-up.
const BookingLookahead = 60 * 24 * time.Hour

const defaultMinutes = 60

// Calendar is her sessions calendar, read and written.
type Calendar interface {
	EventSource
	Get(ctx context.Context, id string) (calendar.Event, error)
	Insert(ctx context.Context, in calendar.EventInput) (calendar.Event, error)
	Update(ctx context.Context, id, etag string, in calendar.EventInput) (calendar.Event, error)
	Delete(ctx context.Context, id, etag string) error
}

type SettingsStore interface {
	Get(ctx context.Context) (settings.Settings, error)
}

// Editor writes the sessions she adds, edits and deletes in the app to the
// calendar, then applies each change exactly as the next sync would, so the
// app shows it at once and the sync finds nothing left to do.
type Editor struct {
	// Calendar opens the calendar she chose in Settings.
	Calendar  func(ctx context.Context) (Calendar, error)
	Clients   ClientStore
	Sessions  SessionStore
	Settings  SettingsStore
	Billing   Reconciler
	Lookahead time.Duration
	Now       func() time.Time
}

// Draft is a session as she fills it in. The title is written from it in the
// calendar syntax, so it always parses and matches the client.
type Draft struct {
	ClientID string    `json:"clientId"`
	Start    time.Time `json:"start"`
	// Minutes defaults to an hour.
	Minutes int `json:"minutes"`
	// FeeCents is what she was paid; nil leaves it to a package credit or
	// the client's default fee.
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
	r.Register("sessions.get", router.Typed(e.get))
	r.Register("sessions.create", router.Typed(e.create))
	r.Register("sessions.update", router.Typed(e.update))
	r.Register("sessions.delete", router.Typed(e.delete))
}

type getInput struct {
	EventID string `json:"eventId"`
}

// Stored is a session with the draft to start an edit from. The title is
// read here, so the app never parses the syntax itself.
type Stored struct {
	Session sessions.Session `json:"session"`
	Draft   Draft            `json:"draft"`
}

func (e Editor) get(ctx context.Context, in getInput) (any, error) {
	s, found, err := e.Sessions.Get(ctx, in.EventID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, apperr.NotFound("This session is no longer in the calendar.")
	}
	return Stored{Session: s, Draft: draftOf(s)}, nil
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
	return nil, e.apply(ctx, cal, event.ID, &event)
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
	return nil, e.apply(ctx, cal, in.EventID, &event)
}

type deleteInput struct {
	EventID string `json:"eventId"`
}

// delete removes the event from the calendar, and the session with it.
func (e Editor) delete(ctx context.Context, in deleteInput) (any, error) {
	cal, live, err := e.current(ctx, in.EventID)
	if errors.Is(err, calendar.ErrGone) {
		// Already deleted in the calendar; current has removed the session.
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if err := cal.Delete(ctx, in.EventID, live.ETag); err != nil && !errors.Is(err, calendar.ErrGone) {
		return nil, err
	}
	return nil, e.apply(ctx, cal, in.EventID, nil)
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

	all, err := e.Clients.List(ctx)
	if err != nil {
		return clients.Client{}, err
	}
	for _, c := range all {
		if c.ID == d.ClientID {
			return c, nil
		}
	}
	return clients.Client{}, apperr.NotFound("client not found")
}

// current reads the event behind a stored session she is about to change. A
// session with a receipt can't be changed. If the calendar changed since the
// last sync, the change is applied and the edit refused, so she sees the
// latest before deciding again.
func (e Editor) current(ctx context.Context, eventID string) (Calendar, calendar.Event, error) {
	before, found, err := e.Sessions.Get(ctx, eventID)
	if err != nil {
		return nil, calendar.Event{}, err
	}
	if !found {
		return nil, calendar.Event{}, apperr.NotFound("session not found")
	}
	if before.Document != nil {
		return nil, calendar.Event{}, apperr.Conflict("Cancel the receipt for this session first.")
	}

	cal, err := e.Calendar(ctx)
	if err != nil {
		return nil, calendar.Event{}, err
	}
	live, err := cal.Get(ctx, eventID)
	if errors.Is(err, calendar.ErrGone) || (err == nil && !isSession(live)) {
		if err := e.apply(ctx, cal, eventID, nil); err != nil {
			return nil, calendar.Event{}, err
		}
		return nil, calendar.Event{}, calendar.ErrGone
	}
	if err != nil {
		return nil, calendar.Event{}, err
	}
	if _, changed := eventChange(&live, &before); changed {
		if err := e.apply(ctx, cal, eventID, &live); err != nil {
			return nil, calendar.Event{}, err
		}
		return nil, calendar.Event{}, calendar.ErrChanged
	}
	return cal, live, nil
}

// apply makes the stored session match the event (nil when deleted) as the
// sync would: only an event that has started is a session. It then
// refreshes next bookings, which the event may have moved.
func (e Editor) apply(ctx context.Context, cal Calendar, eventID string, event *calendar.Event) error {
	now := e.Now().UTC()
	if event != nil && (!isSession(*event) || !event.Start.Before(now)) {
		event = nil
	}

	before, found, err := e.Sessions.Get(ctx, eventID)
	if err != nil {
		return err
	}
	if change, changed := eventChange(event, optional(before, found)); changed {
		if _, err := e.Billing.Reconcile(ctx, billing.Scope{Changes: []billing.Change{change}}); err != nil {
			return err
		}
	}

	all, err := e.Clients.List(ctx)
	if err != nil {
		return err
	}
	bookings := Syncer{Events: cal, Clients: e.Clients, Lookahead: e.Lookahead}
	return bookings.updateBookings(ctx, all, calendar.AliasesOf(all), now)
}

// eventInput writes the draft as an event. Editing keeps the name she wrote
// if it still means this client, and the colour if it still says the
// location she chose.
func (e Editor) eventInput(ctx context.Context, d Draft, client clients.Client, existing *calendar.Event) (calendar.EventInput, error) {
	cfg, err := e.Settings.Get(ctx)
	if err != nil {
		return calendar.EventInput{}, err
	}

	name, existingColor := client.Name, ""
	if existing != nil {
		existingColor = existing.ColorID
		title, err := calendar.ParseTitle(existing.Title)
		if err == nil && calendar.MatchName(title.Name, calendar.AliasesOf([]clients.Client{client})).Kind == calendar.MatchExact {
			name = title.Name
		}
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

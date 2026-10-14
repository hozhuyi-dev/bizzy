package googlesync

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"bizzy-lambda/internal/features/billing"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/payments"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/router"
	"bizzy-lambda/internal/shared/docref"
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
	Billing  EditorBilling
	// Payments moves what was paid to a new amount, when she asks to with
	// an edit (Draft.UpdatePayment).
	Payments payments.Store
	// Packages keeps or deletes the package a deleted session bought.
	Packages interface {
		Get(ctx context.Context, id string) (packages.Package, bool, error)
		Save(ctx context.Context, p packages.Package) error
		Delete(ctx context.Context, id string) (bool, error)
	}
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
	// Confirm says she saw what saving brings on (sessions.impact) and
	// saves anyway.
	Confirm bool `json:"confirm"`
	// UpdatePayment moves what was paid for it, and for the package it
	// buys, to the new amounts: what she collected or refunded with the
	// change.
	UpdatePayment bool `json:"updatePayment"`
}

type DraftPackage struct {
	Sessions   int   `json:"sessions"`
	PriceCents int64 `json:"priceCents"`
}

func RegisterEditor(r *router.Router, e Editor) {
	r.Query("sessions.get", router.Typed(e.get))
	r.Query("sessions.impact", router.Typed(e.preview))
	r.Query("sessions.deleteImpact", router.Typed(e.deletionPreview))
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
	d := draftOf(s)
	// A title that can't be read still holds the package it bought (see
	// billing.linkPackages): the form starts from it, so fixing the title
	// keeps it.
	if _, err := calendar.ParseTitle(s.Title); err != nil && e.Packages != nil {
		p, found, err := e.Packages.Get(ctx, s.EventID)
		if err != nil {
			return nil, err
		}
		if found && p.Source == packages.SourceCalendar && !p.Unlinked {
			d.Package = &DraftPackage{Sessions: p.Sessions, PriceCents: p.PriceCents}
		}
	}
	return Stored{Session: s.View(now()), Draft: d, Notes: notes.Text}, nil
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
	// With no amount, the fee an issued document says keeps it true.
	for _, slot := range docref.Slots {
		if ref := s.Ref(slot); d.FeeCents == nil && ref.Issued() && ref.FeeCents != nil {
			fee := *ref.FeeCents
			d.FeeCents = &fee
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
	if err := e.check(ctx, "", d, client, in); err != nil {
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
	cal, live, err := e.current(ctx, in.EventID, nil)
	if err != nil {
		return nil, err
	}
	input, err := e.eventInput(ctx, in.Draft, client, &live)
	if err != nil {
		return nil, err
	}
	if err := e.check(ctx, in.EventID, in.Draft, client, input); err != nil {
		return nil, err
	}

	event, err := cal.Update(ctx, in.EventID, live.ETag, input)
	if err != nil {
		return nil, err
	}
	if err := e.apply(ctx, in.EventID, &event, false); err != nil {
		return nil, err
	}
	if !in.UpdatePayment {
		return nil, nil
	}
	ids, err := payments.Reprice(ctx, e.Payments, in.EventID, e.now())
	if err != nil || len(ids) == 0 {
		return nil, err
	}
	_, err = e.Billing.Reconcile(ctx, billing.Scope{ClientIDs: ids})
	return nil, err
}

func (e Editor) now() time.Time {
	if e.Now != nil {
		return e.Now()
	}
	return time.Now()
}

// What happens to the package a deleted session bought.
const (
	// KeepPackage keeps it as a standalone package, with its credits,
	// payment and documents.
	KeepPackage = "keep"
	// DeletePackage deletes it too, as packages.delete would.
	DeletePackage = "delete"
)

type deleteInput struct {
	EventID string `json:"eventId"`
	// Package says what happens to the package its title bought, if any:
	// KeepPackage (the default) or DeletePackage. She is asked, rather
	// than left to sort it out on the to-do list.
	Package string `json:"package"`
	// Confirm says she saw what deleting its package brings on
	// (sessions.deleteImpact) and deletes anyway.
	Confirm bool `json:"confirm"`
}

// delete removes the event from the calendar, and the session with it and
// its notes: she chose to. Not while paid or on a document.
func (e Editor) delete(ctx context.Context, in deleteInput) (any, error) {
	// The session's own guard first, as its view says.
	if s, found, err := e.Sessions.Get(ctx, in.EventID); err != nil {
		return nil, err
	} else if found {
		if err := s.CanDelete(); err != nil {
			return nil, err
		}
	}
	bought, err := e.boughtPackage(ctx, in)
	if err != nil {
		return nil, err
	}
	cal, live, err := e.current(ctx, in.EventID, sessions.Session.CanDelete)
	switch {
	case errors.Is(err, calendar.ErrGone):
		// Already deleted in the calendar.
	case err != nil:
		return nil, err
	default:
		if err := cal.Delete(ctx, in.EventID, live.ETag); err != nil && !errors.Is(err, calendar.ErrGone) {
			return nil, err
		}
	}
	if err := e.apply(ctx, in.EventID, nil, true); err != nil || bought == nil {
		return nil, err
	}
	// Unlinked by now: kept or deleted as she chose.
	if in.Package == DeletePackage {
		if _, err := e.Packages.Delete(ctx, bought.ID); err != nil {
			return nil, err
		}
	} else {
		p, found, err := e.Packages.Get(ctx, bought.ID)
		if err != nil || !found {
			return nil, err
		}
		p.Source, p.Unlinked = packages.SourceApp, false
		if err := e.Packages.Save(ctx, p); err != nil {
			return nil, err
		}
	}
	_, err = e.Billing.Reconcile(ctx, billing.Scope{ClientIDs: []string{bought.ClientID}})
	return nil, err
}

// boughtPackage is the package the session's title bought, once she said
// what happens to it, and it can: nil when it bought none.
func (e Editor) boughtPackage(ctx context.Context, in deleteInput) (*packages.Package, error) {
	p, found, err := e.Packages.Get(ctx, in.EventID)
	if err != nil || !found || p.Source != packages.SourceCalendar {
		return nil, err
	}
	switch in.Package {
	case KeepPackage, "":
	case DeletePackage:
		// As packages.delete, once the calendar no longer buys it.
		p.Unlinked = true
		if err := p.CanDelete(); err != nil {
			return nil, err
		}
	default:
		return nil, apperr.Invalid("A package bought in a session is kept or deleted with it.")
	}
	impact, err := e.Billing.DeletionImpact(ctx, in.EventID, in.Package == DeletePackage)
	if err != nil {
		return nil, err
	}
	if err := impact.Check(in.Confirm); err != nil {
		return nil, err
	}
	return &p, nil
}

// deletionPreview is what deleting the session would bring on, with its
// package kept or deleted as chosen, for the dialog to show first.
func (e Editor) deletionPreview(ctx context.Context, in deleteInput) (any, error) {
	return e.Billing.DeletionImpact(ctx, in.EventID, in.Package == DeletePackage)
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

// current reads the event behind a stored session she is about to change,
// once guard (if any) allows it. If the calendar changed since the last
// sync, the change is applied and the edit refused, so she sees the latest
// before deciding again.
func (e Editor) current(ctx context.Context, eventID string, guard func(sessions.Session) error) (Calendar, calendar.Event, error) {
	before, found, err := e.Sessions.Get(ctx, eventID)
	if err != nil {
		return nil, calendar.Event{}, err
	}
	if !found {
		return nil, calendar.Event{}, apperr.NotFound("session not found")
	}
	if guard != nil {
		if err := guard(before); err != nil {
			return nil, calendar.Event{}, err
		}
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

// Refresh applies whatever the calendar changed on these sessions' events
// since the last sync, as the sync would, so what is about to be issued
// from them says what the calendar does now: one gone or changed, one back,
// or the event of a package whose session was discarded.
func (e Editor) Refresh(ctx context.Context, eventIDs ...string) error {
	if len(eventIDs) == 0 {
		return nil
	}
	cal, err := e.Calendar(ctx)
	if err != nil {
		return err
	}
	for _, id := range eventIDs {
		before, found, err := e.Sessions.Get(ctx, id)
		if err != nil {
			return err
		}
		if !found {
			// A package whose session was discarded: its event may be back.
			if _, bought, err := e.Packages.Get(ctx, id); err != nil || !bought {
				if err != nil {
					return err
				}
				continue
			}
			before.RemovedAt = &time.Time{}
		}
		live, err := cal.Get(ctx, id)
		switch {
		case errors.Is(err, calendar.ErrGone) || (err == nil && !isSession(live)):
			err = nil
			if before.RemovedAt == nil {
				err = e.apply(ctx, id, nil, false)
			}
		case err != nil:
		case before.RemovedAt != nil || calendarChanged(before, live):
			// Changed, or back in the calendar.
			err = e.apply(ctx, id, &live, false)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// impact is what writing in for the session (eventID "" for a new one)
// would bring on. Besides what billing.ImpactOf refuses, a booking can't
// leave a confirmed session without a fee: the form asks for one.
func (e Editor) impact(ctx context.Context, eventID string, d Draft, client clients.Client, in calendar.EventInput) (billing.Impact, error) {
	_, brought, err := e.Billing.BookingImpact(ctx, eventID, calendar.Event{Title: in.Title, Start: in.Start, End: in.End, ColorID: in.ColorID}, d.UpdatePayment)
	if err != nil {
		return billing.Impact{}, err
	}
	out := billing.ImpactOf(brought)
	if d.UpdatePayment && out.Refused == "" {
		if err := e.canReprice(ctx, eventID); err != nil {
			out.Refused = statemodel.Check(err).Why
		}
	}
	self := cmp.Or(eventID, "new")
	if out.Refused == "" && slices.ContainsFunc(brought, func(b billing.Brought) bool {
		return b.Kind == "session" && b.ID == self && b.Rule == "fee-missing"
	}) {
		out.Refused = fmt.Sprintf("Enter the fee: %s has no usual fee, and no package credit covers this session.", client.Name)
		out.NeedsFee = true
	}
	return out, nil
}

// canReprice says whether what was paid for the session, and for the
// package it bought, can move to new amounts: not while a receipt covers
// it.
func (e Editor) canReprice(ctx context.Context, eventID string) error {
	if s, found, err := e.Sessions.Get(ctx, eventID); err != nil {
		return err
	} else if found && s.Payment.IsPaid() && s.Receipt != nil {
		return apperr.Conflict("A receipt covers this payment. Cancel or discard it first.")
	}
	if p, found, err := e.Packages.Get(ctx, eventID); err != nil {
		return err
	} else if found && p.Payment.IsPaid() {
		return p.CanPay()
	}
	return nil
}

// check refuses a booking edit its impact doesn't allow.
func (e Editor) check(ctx context.Context, eventID string, d Draft, client clients.Client, in calendar.EventInput) error {
	impact, err := e.impact(ctx, eventID, d, client, in)
	if err != nil {
		return err
	}
	return impact.Check(d.Confirm)
}

// preview is what saving the draft would bring on, for the form to show
// before she saves. It reads the event without applying any change.
func (e Editor) preview(ctx context.Context, in updateInput) (any, error) {
	client, err := e.validate(ctx, in.Draft)
	if err != nil {
		return nil, err
	}
	var existing *calendar.Event
	if in.EventID != "" {
		cal, err := e.Calendar(ctx)
		if err != nil {
			return nil, err
		}
		live, err := cal.Get(ctx, in.EventID)
		if err != nil && !errors.Is(err, calendar.ErrGone) {
			return nil, err
		}
		if err == nil {
			existing = &live
		}
	}
	input, err := e.eventInput(ctx, in.Draft, client, existing)
	if err != nil {
		return nil, err
	}
	return e.impact(ctx, in.EventID, in.Draft, client, input)
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

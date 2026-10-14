package book

import (
	"fmt"
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
)

// Booking is a session's booking as she fills it in: in the app's form, or
// in an event's title in the calendar.
type Booking struct {
	ClientID  string            `json:"clientId"`
	Start     time.Time         `json:"start"`
	End       time.Time         `json:"end"`
	Tentative bool              `json:"tentative"`
	Location  sessions.Location `json:"location"`
	// FeeCents is a fee entered for this session; nil leaves it to a
	// package credit or the client's usual fee.
	FeeCents *int64 `json:"feeCents,omitempty"`
	// Package is one bought in this session.
	Package *PackageSpec `json:"package,omitempty"`
}

// PackageSpec is a package bought in a session: `10x85` is 10 sessions for
// 850 in all.
type PackageSpec struct {
	Sessions   int   `json:"sessions"`
	PriceCents int64 `json:"priceCents"`
}

func (bk Booking) check(b *Book) error {
	if _, err := b.Client(bk.ClientID); err != nil {
		return err
	}
	switch {
	case bk.Start.IsZero():
		return apperr.Invalid("a session needs a start time")
	case !bk.End.After(bk.Start):
		return apperr.Invalid("a session ends after it starts")
	case bk.End.Sub(bk.Start) > maxSession:
		return apperr.Invalid("a session lasts at most 12 hours")
	case bk.FeeCents != nil && *bk.FeeCents < 0:
		return apperr.Invalid("the fee can't be negative")
	case bk.Location != sessions.LocationOwn && bk.Location != sessions.LocationVisit:
		return apperr.Invalid("a session is at her place or a home visit")
	}
	if p := bk.Package; p != nil {
		switch {
		case p.Sessions < 1 || p.Sessions > 1000:
			return apperr.Invalid("a package has 1 to 1000 sessions")
		case p.PriceCents < 0:
			return apperr.Invalid("a package's price can't be negative")
		}
	}
	return nil
}

func (bk Booking) applyTo(b *Book, s *sessions.Session) {
	s.Start, s.End, s.Tentative, s.Location = bk.Start.UTC(), bk.End.UTC(), bk.Tentative, bk.Location
	switch {
	case bk.Tentative:
		s.ConfirmedAt = nil
	case s.ConfirmedAt == nil:
		// Booked confirmed: now, or its start for one already past.
		at := b.Now.UTC()
		if s.Start.Before(at) {
			at = s.Start
		}
		s.ConfirmedAt = &at
	}
}

// CreateSession books a session: from the app, or from a new event in the
// calendar.
type CreateSession struct {
	Booking
	// ID is the new session's.
	ID string `json:"-"`
	// Event is the calendar event it is read from, when she booked it
	// there; nil when the app books it, and writes its event after.
	Event *calendar.Event `json:"-"`
	// Problem is what the event's title couldn't say (see googlesync).
	Problem *Problem `json:"-"`
}

func (CreateSession) Action() string { return "sessions.create" }

func (c CreateSession) Scope() Scope { return Scope{Clients: []string{c.ClientID}} }

func (c CreateSession) Apply(b *Book) error {
	if c.Problem != nil {
		b.problem(Key("session", c.ID), *c.Problem)
		return nil
	}
	if err := c.check(b); err != nil {
		return b.unreadable(Key("session", c.ID), c.Event, false, err)
	}
	s := &sessions.Session{ID: c.ID, ClientID: c.ClientID, CreatedAt: b.Now.UTC()}
	c.applyTo(b, s)
	if e := c.Event; e != nil {
		snap := calendar.SnapshotOf(*e)
		s.Event = calendar.Link{EventID: e.ID, Seen: &snap}
		b.Effects.Externals = append(b.Effects.Externals, conflicts.External{
			Surface: conflicts.SurfaceCalendar, ExternalID: e.ID, Kind: conflicts.ShowsSession, ID: s.ID,
		})
		b.Effects.ConflictsGone = append(b.Effects.ConflictsGone, conflicts.Key(conflicts.SurfaceCalendar, e.ID))
	}
	b.Sessions[s.ID] = s
	into := ""
	if c.Package != nil {
		p := b.buy(s, *c.Package, "")
		into = b.draftInvoiceOf(packageSource(p.ID))
	}
	b.price(s, c.FeeCents, into)
	b.checkWritable(s)
	return nil
}

// UpdateSession changes a session's booking to what she filled in. From
// the calendar, it is the booking her edit to the event asks for.
type UpdateSession struct {
	ID string `json:"id"`
	Booking
	// UpdatePayment moves what was received for it, and for the package
	// bought in it, to their new amounts, on a receipt not issued yet:
	// what she collected or refunded with the change.
	UpdatePayment bool `json:"updatePayment"`
	// FromCalendar marks an edit she made to the event, which then shows
	// Seen.
	FromCalendar bool               `json:"-"`
	Seen         *calendar.Snapshot `json:"-"`
	Problem      *Problem           `json:"-"`
}

func (UpdateSession) Action() string { return "sessions.update" }

func (c UpdateSession) Scope() Scope {
	return Scope{Sessions: []string{c.ID}, Clients: []string{c.ClientID}}
}

func (c UpdateSession) Apply(b *Book) error {
	s, err := b.Session(c.ID)
	if err != nil {
		return err
	}
	if c.Problem != nil {
		b.problem(Key("session", s.ID), *c.Problem)
		return nil
	}
	if err := c.check(b); err != nil {
		if c.FromCalendar {
			return b.unreadable(Key("session", s.ID), &calendar.Event{ID: s.Event.EventID}, false, err)
		}
		return err
	}
	old := deepCopy(*s)
	moved := c.ClientID != s.ClientID

	if moved {
		// Its lines, and those of the package bought in it, go to the new
		// client's drafts, together.
		into := map[documents.Type]string{}
		b.moveToClient(sessionSource(s.ID), c.ClientID, into)
		if p, ok := b.Packages[s.BoughtPackageID]; ok {
			p.ClientID = c.ClientID
			b.moveToClient(packageSource(p.ID), c.ClientID, into)
		}
		s.ClientID = c.ClientID
		b.unlinkFollowUps(s)
	}
	c.applyTo(b, s)

	bought := b.rebuy(s, c.Package)
	switch {
	case c.FeeCents != nil, old.FeeTyped, moved, bought == boughtAdded,
		s.OnCredit() && b.Packages[s.PackageID] == nil:
		// What pays for it is asked to change, or what did is gone.
		b.price(s, c.FeeCents, b.draftInvoiceOf(packageSource(s.BoughtPackageID)))
	}

	b.redate(sessionSource(s.ID))
	if p, ok := b.Packages[s.BoughtPackageID]; ok {
		b.redate(packageSource(p.ID))
	}
	if c.UpdatePayment {
		b.repay(sessionSource(s.ID))
		if s.BoughtPackageID != "" {
			b.repay(packageSource(s.BoughtPackageID))
		}
	}
	switch {
	case c.FromCalendar:
		s.Event.Seen = c.Seen
		b.Effects.ConflictsGone = append(b.Effects.ConflictsGone, conflicts.Key(conflicts.SurfaceCalendar, s.Event.EventID))
	default:
		b.Effects.Rebooked = append(b.Effects.Rebooked, s.ID)
	}
	b.checkWritable(s)
	return nil
}

type rebought int

const (
	boughtSame rebought = iota
	boughtAdded
	boughtDropped
)

// rebuy makes the package bought in the session what the booking says:
// bought, changed, or no longer bought (deleted with its lines; any session
// still using its credits is then the guards' to refuse).
func (b *Book) rebuy(s *sessions.Session, spec *PackageSpec) rebought {
	p, had := b.Packages[s.BoughtPackageID]
	switch {
	case spec == nil && !had:
		return boughtSame
	case spec == nil:
		b.removeLines(packageSource(p.ID), "")
		delete(b.Packages, p.ID)
		s.BoughtPackageID = ""
		return boughtDropped
	case !had:
		b.buy(s, *spec, b.draftInvoiceOf(sessionSource(s.ID)))
		return boughtAdded
	}
	was := p.Sessions
	p.Sessions, p.PurchasedAt, p.ClientID = spec.Sessions, s.Start, s.ClientID
	b.resize(p, was)
	b.setAmount(packageSource(p.ID), documents.TypeInvoice, spec.PriceCents)
	return boughtSame
}

// buy records a package bought in a session, on a draft invoice (into, or
// a new one).
func (b *Book) buy(s *sessions.Session, spec PackageSpec, into string) *packages.Package {
	p := &packages.Package{
		ID: b.NewID(), ClientID: s.ClientID, Sessions: spec.Sessions,
		PurchasedAt: s.Start, BoughtIn: s.ID, CreatedAt: b.Now.UTC(),
	}
	b.Packages[p.ID] = p
	s.BoughtPackageID = p.ID
	b.addLine(documents.TypeInvoice, s.ClientID, into, b.packageLine(p, spec.PriceCents))
	return p
}

// repay moves what a receipt says was received for an item to what its
// invoice now charges.
func (b *Book) repay(src documents.Source) {
	if _, paid := b.line(src, documents.TypeReceipt); paid {
		b.setAmount(src, documents.TypeReceipt, b.invoiceAmount(src))
	}
}

// unreadable is what a booking or follow-up that makes no sense is: from
// the app, the error to show; from an event in the calendar, a problem the
// title-readable guard refuses, so the sync keeps it as a conflict.
func (b *Book) unreadable(key string, e *calendar.Event, followUp bool, err error) error {
	if e == nil {
		return err
	}
	b.problem(key, Problem{Kind: Unreadable, Text: "The event can't be read: " + err.Error() + ".", EventID: e.ID, FollowUp: followUp})
	return nil
}

// checkWritable records a client whose name can't be written in the
// session's title.
func (b *Book) checkWritable(s *sessions.Session) {
	if c := b.Clients[s.ClientID]; !Writable(WrittenName(c, s.Event.Seen)) {
		b.problem(Key("session", s.ID), Problem{
			Kind: Unwritable, ClientID: c.ID, EventID: s.Event.EventID,
			Text: fmt.Sprintf("%q can't be written in a calendar title. Give the client a name that doesn't end in a number.", c.Name),
		})
	}
}

// DeleteSession deletes a session with what she recorded on it: from the
// app, or by deleting its event in the calendar.
type DeleteSession struct {
	ID string `json:"id"`
	// KeepPackage keeps the package bought in it as one on its own; it is
	// deleted with it otherwise.
	KeepPackage  bool `json:"keepPackage"`
	FromCalendar bool `json:"-"`
}

func (DeleteSession) Action() string { return "sessions.delete" }

func (c DeleteSession) Scope() Scope { return Scope{Sessions: []string{c.ID}} }

func (c DeleteSession) Apply(b *Book) error {
	s, err := b.Session(c.ID)
	if err != nil {
		return err
	}
	b.removeLines(sessionSource(s.ID), "")
	if p, ok := b.Packages[s.BoughtPackageID]; ok {
		if c.KeepPackage {
			p.BoughtIn = ""
		} else {
			b.removeLines(packageSource(p.ID), "")
			delete(b.Packages, p.ID)
		}
	}
	delete(b.Sessions, s.ID)
	b.unlinkFollowUps(s)
	b.Effects.Purged = append(b.Effects.Purged, s.ID)
	if id := s.Event.EventID; id != "" {
		b.Effects.ExternalsGone = append(b.Effects.ExternalsGone, id)
		b.Effects.ConflictsGone = append(b.Effects.ConflictsGone, conflicts.Key(conflicts.SurfaceCalendar, id))
		if !c.FromCalendar {
			b.Effects.EventsGone = append(b.Effects.EventsGone, id)
		}
	}
	return nil
}

// RepriceDrafts applies a client's usual fees as they are now to sessions
// charged their usual fee on a draft invoice and not paid: once she
// changes them, what isn't invoiced or paid yet follows; the rest keeps the
// fee it was charged.
type RepriceDrafts struct {
	ClientID string `json:"clientId"`
}

func (RepriceDrafts) Action() string { return "clients.save" }

func (c RepriceDrafts) Scope() Scope { return Scope{Clients: []string{c.ClientID}} }

func (c RepriceDrafts) Apply(b *Book) error {
	client, err := b.Client(c.ClientID)
	if err != nil {
		return err
	}
	for _, s := range b.ClientSessions(c.ClientID) {
		src := sessionSource(s.ID)
		l, ok := b.line(src, documents.TypeInvoice)
		_, paid := b.line(src, documents.TypeReceipt)
		if s.FeeTyped || !ok || paid || l.doc.Status != documents.StatusDraft {
			continue
		}
		if fee := client.FeeOn(b.LocalDate(s.Start)); fee != nil {
			l.Line().AmountCents = *fee
		}
	}
	return nil
}

// Together is several commands applied as one change: edits read from the
// calendar in one sync that only make sense together (two sessions swapped
// there, each in the other's slot until both move). Every guard on each
// command's action judges the change as a whole, so it is held to every
// rule its commands are.
type Together []Command

func (Together) Action() string { return "calendar.together" }

func (t Together) Scope() Scope {
	var s Scope
	for _, c := range t {
		cs := c.Scope()
		s.Sessions = append(s.Sessions, cs.Sessions...)
		s.Packages = append(s.Packages, cs.Packages...)
		s.Documents = append(s.Documents, cs.Documents...)
		s.FollowUps = append(s.FollowUps, cs.FollowUps...)
		s.Clients = append(s.Clients, cs.Clients...)
		s.Numbering = s.Numbering || cs.Numbering
	}
	return s
}

func (t Together) Apply(b *Book) error {
	for _, c := range t {
		if err := c.Apply(b); err != nil {
			return err
		}
	}
	return nil
}

// OverlapGuard is the guard that keeps sessions from overlapping.
const OverlapGuard = "sessions-never-overlap"

// unlinkFollowUps takes a session gone, or gone to another client, off the
// follow-ups made from it that are no longer about it.
func (b *Book) unlinkFollowUps(s *sessions.Session) {
	for _, f := range b.FollowUps {
		if f.SessionID == s.ID && (b.Sessions[s.ID] == nil || f.ClientID != s.ClientID) {
			f.SessionID = ""
		}
	}
}

// LinkEvent records the event that shows a session or a follow-up (Kind,
// ID), in place of the one it had: the app wrote it, or wrote it again for
// one deleted, or a sync found it after the app died before recording it.
// The item, what its new event shows and what its old one showed change
// together.
type LinkEvent struct {
	Kind  conflicts.ExternalKind
	ID    string
	Event calendar.Event
}

func (LinkEvent) Action() string { return "calendar.link" }

func (c LinkEvent) Scope() Scope {
	if c.Kind == conflicts.ShowsFollowUp {
		return Scope{FollowUps: []string{c.ID}}
	}
	return Scope{Sessions: []string{c.ID}}
}

func (c LinkEvent) Apply(b *Book) error {
	var link *calendar.Link
	snap := calendar.SnapshotOf(c.Event)
	switch c.Kind {
	case conflicts.ShowsFollowUp:
		f, err := b.FollowUp(c.ID)
		if err != nil {
			return err
		}
		link, snap = &f.Event, calendar.NotedSnapshotOf(c.Event)
	default:
		s, err := b.Session(c.ID)
		if err != nil {
			return err
		}
		link = &s.Event
	}
	if old := link.EventID; old != "" && old != c.Event.ID {
		b.Effects.ExternalsGone = append(b.Effects.ExternalsGone, old)
		b.Effects.ConflictsGone = append(b.Effects.ConflictsGone, conflicts.Key(conflicts.SurfaceCalendar, old))
	}
	*link = calendar.Link{EventID: c.Event.ID, Seen: &snap}
	b.Effects.Externals = append(b.Effects.Externals, conflicts.External{
		Surface: conflicts.SurfaceCalendar, ExternalID: c.Event.ID, Kind: c.Kind, ID: c.ID,
	})
	return nil
}

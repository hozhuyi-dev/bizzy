package book

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/router"
)

// Notes reads a session's long notes, for the form.
type Notes interface {
	Notes(ctx context.Context, id string) (sessions.Notes, error)
}

type handler struct {
	x     Executor
	notes Notes
}

// Register serves every change to sessions, packages, payments, documents
// and follow-ups, each a command of the book, and what the booking form
// asks before saving.
func Register(r *router.Router, x Executor, notes Notes) {
	h := handler{x: x, notes: notes}
	r.Query("sessions.get", router.Typed(h.get))
	r.Query("billing.preview", router.Typed(h.preview))
	r.Mutation("sessions.create", router.Typed(h.create))
	r.Mutation("sessions.update", router.Typed(h.update))
	r.Mutation("sessions.delete", router.Typed(h.delete))
	r.Mutation("packages.save", router.Typed(h.savePackage))
	r.Mutation("packages.delete", router.Typed(h.deletePackage))
	r.Mutation("packages.makeStandalone", router.Typed(h.makeStandalone))
	r.Mutation("payments.set", router.Typed(h.pay))
	r.Mutation("documents.saveDraft", router.Typed(h.document(func(in docInput) Command { return SaveDraft{ID: in.ID, Version: in.Version, Content: in.Content} })))
	r.Mutation("documents.issue", router.Typed(h.document(func(in docInput) Command { return Issue{ID: in.ID, Version: in.Version} })))
	r.Mutation("documents.revise", router.Typed(h.document(func(in docInput) Command { return Revise{ID: in.ID, Version: in.Version} })))
	r.Mutation("documents.discardDraft", router.Typed(h.document(func(in docInput) Command { return DiscardDraft{ID: in.ID, Version: in.Version} })))
	r.Mutation("documents.cancel", router.Typed(h.document(func(in docInput) Command {
		return Cancel{ID: in.ID, Version: in.Version, Reason: in.Reason}
	})))
	r.Mutation("documents.moveLines", router.Typed(h.moveLines))
	r.Mutation("followUps.create", router.Typed(h.createFollowUp))
	r.Mutation("followUps.update", router.Typed(h.updateFollowUp))
	r.Mutation("followUps.delete", router.Typed(h.deleteFollowUp))
	r.Mutation("followUps.setDone", router.Typed(h.setFollowUpDone))
}

// Draft is a booking as the form fills it in.
type Draft struct {
	ClientID string    `json:"clientId"`
	Start    time.Time `json:"start"`
	// Minutes defaults to an hour.
	Minutes int `json:"minutes"`
	// FeeCents is what the session costs; nil leaves it to a package credit
	// or the client's usual fee.
	FeeCents *int64       `json:"feeCents,omitempty"`
	Package  *PackageSpec `json:"package,omitempty"`
	// HomeVisit says where it is.
	HomeVisit bool `json:"homeVisit"`
	Tentative bool `json:"tentative"`
}

const defaultMinutes = 60

func (d Draft) booking() (Booking, error) {
	minutes := d.Minutes
	switch {
	case minutes == 0:
		minutes = defaultMinutes
	case minutes < 5 || minutes > 12*60:
		return Booking{}, apperr.Invalid("a session lasts 5 minutes to 12 hours")
	}
	if d.ClientID == "" {
		return Booking{}, apperr.Invalid("choose a client")
	}
	location := sessions.LocationOwn
	if d.HomeVisit {
		location = sessions.LocationVisit
	}
	return Booking{
		ClientID: d.ClientID, Start: d.Start.UTC(), End: d.Start.UTC().Add(time.Duration(minutes) * time.Minute),
		Tentative: d.Tentative, Location: location, FeeCents: d.FeeCents, Package: d.Package,
	}, nil
}

// DraftOf is the form's draft of a stored session.
func (b *Book) DraftOf(s *sessions.Session) Draft {
	d := Draft{
		ClientID: s.ClientID, Start: s.Start, Minutes: int(s.End.Sub(s.Start).Minutes()),
		HomeVisit: s.Location == sessions.LocationVisit, Tentative: s.Tentative,
	}
	if s.FeeTyped && !s.OnCredit() {
		fee := s.FeeCents
		d.FeeCents = &fee
	}
	if p, ok := b.Packages[s.BoughtPackageID]; ok {
		d.Package = &PackageSpec{Sessions: p.Sessions, PriceCents: p.PriceCents}
	}
	return d
}

type idInput struct {
	ID string `json:"id"`
}

// Stored is a session with the draft to start an edit from, and its notes.
type Stored struct {
	Session sessions.View `json:"session"`
	Draft   Draft         `json:"draft"`
	Notes   string        `json:"notes"`
}

func (h handler) get(ctx context.Context, in idInput) (any, error) {
	b, err := h.x.Load(ctx, Scope{Sessions: []string{in.ID}})
	if err != nil {
		return nil, err
	}
	s, err := b.Session(in.ID)
	if err != nil {
		return nil, err
	}
	notes, err := h.notes.Notes(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	return Stored{Session: s.View(b.Now, b.SessionCan(s.ID)), Draft: b.DraftOf(s), Notes: notes.Text}, nil
}

// PreviewInput is a booking as the form has it, with no fee entered: what
// would pay for it once saved.
type PreviewInput struct {
	ClientID string    `json:"clientId"`
	Start    time.Time `json:"start"`
	// SessionID is the session being edited, if any: it keeps what pays
	// for it unless something else changes.
	SessionID string `json:"sessionId,omitempty"`
	// BuysPackage says it buys a package, whose first credit it uses.
	BuysPackage bool `json:"buysPackage"`
}

type CoverKind string

const (
	CoverNone    CoverKind = "none"
	CoverBought  CoverKind = "bought"
	CoverCredit  CoverKind = "credit"
	CoverDefault CoverKind = "default"
)

// Cover is what would pay for a session.
type Cover struct {
	Kind      CoverKind `json:"kind"`
	PackageID string    `json:"packageId,omitempty"`
	FeeCents  *int64    `json:"feeCents,omitempty"`
}

// preview decides the booking without saving it, and says what pays for
// it.
func (h handler) preview(ctx context.Context, in PreviewInput) (any, error) {
	if in.BuysPackage {
		return Cover{Kind: CoverBought}, nil
	}
	bk := Booking{ClientID: in.ClientID, Start: in.Start.UTC(), End: in.Start.UTC().Add(time.Hour), Location: sessions.LocationOwn}
	var cmd Command = CreateSession{Booking: bk, ID: "preview"}
	id := "preview"
	if in.SessionID != "" {
		cmd, id = UpdateSession{ID: in.SessionID, Booking: bk}, in.SessionID
	}
	b, err := h.x.Load(ctx, cmd.Scope())
	if err != nil {
		return nil, err
	}
	if s, ok := b.Sessions[in.SessionID]; ok {
		// Keep what it has but the time: the form says the rest.
		up := cmd.(UpdateSession)
		up.Location, up.Tentative, up.End = s.Location, s.Tentative, up.Start.Add(s.End.Sub(s.Start))
		if p, ok := b.Packages[s.BoughtPackageID]; ok {
			up.Package = &PackageSpec{Sessions: p.Sessions, PriceCents: p.PriceCents}
		}
		cmd = up
	}
	after, _, err := Decide(b, cmd)
	if err != nil {
		return nil, err
	}
	s, ok := after.Sessions[id]
	switch {
	case !ok || after.Unpriced(s):
		return Cover{Kind: CoverNone}, nil
	case s.OnCredit():
		return Cover{Kind: CoverCredit, PackageID: s.PackageID}, nil
	}
	fee := after.invoiceAmount(sessionSource(id))
	return Cover{Kind: CoverDefault, FeeCents: &fee}, nil
}

type created struct {
	ID string `json:"id"`
}

func (h handler) create(ctx context.Context, d Draft) (any, error) {
	bk, err := d.booking()
	if err != nil {
		return nil, err
	}
	cmd := CreateSession{Booking: bk, ID: h.x.NewID()}
	if _, err := h.x.Do(ctx, cmd); err != nil {
		return nil, err
	}
	return created{ID: cmd.ID}, nil
}

type updateInput struct {
	ID string `json:"id"`
	Draft
	UpdatePayment bool `json:"updatePayment"`
}

func (h handler) update(ctx context.Context, in updateInput) (any, error) {
	bk, err := in.booking()
	if err != nil {
		return nil, err
	}
	b, err := h.x.Do(ctx, UpdateSession{ID: in.ID, Booking: bk, UpdatePayment: in.UpdatePayment})
	if err != nil {
		return nil, err
	}
	return b.Sessions[in.ID].View(b.Now, b.SessionCan(in.ID)), nil
}

type deleteInput struct {
	ID string `json:"id"`
	// KeepPackage keeps the package bought in it as one on its own.
	KeepPackage bool `json:"keepPackage"`
}

func (h handler) delete(ctx context.Context, in deleteInput) (any, error) {
	_, err := h.x.Do(ctx, DeleteSession{ID: in.ID, KeepPackage: in.KeepPackage})
	return nil, err
}

func (h handler) savePackage(ctx context.Context, in SavePackage) (any, error) {
	id := in.ID
	if id == "" {
		in.NewID = h.x.NewID()
		id = in.NewID
	}
	b, err := h.x.Do(ctx, in)
	if err != nil {
		return nil, err
	}
	p, ok := b.Packages[id]
	if !ok {
		return nil, nil
	}
	return p.View(b.Now, b.PackageCan(id)), nil
}

func (h handler) deletePackage(ctx context.Context, in DeletePackage) (any, error) {
	_, err := h.x.Do(ctx, in)
	return nil, err
}

func (h handler) makeStandalone(ctx context.Context, in MakeStandalone) (any, error) {
	b, err := h.x.Do(ctx, in)
	if err != nil {
		return nil, err
	}
	return b.Packages[in.ID].View(b.Now, b.PackageCan(in.ID)), nil
}

func (h handler) pay(ctx context.Context, in SetPayment) (any, error) {
	_, err := h.x.Do(ctx, in)
	return nil, err
}

type docInput struct {
	ID      string            `json:"id"`
	Version int               `json:"version"`
	Content documents.Content `json:"content"`
	Reason  string            `json:"reason"`
}

// document runs a step of a document's lifecycle and returns it; null when
// the step deleted it.
func (h handler) document(cmd func(docInput) Command) func(ctx context.Context, in docInput) (any, error) {
	return func(ctx context.Context, in docInput) (any, error) {
		b, err := h.x.Do(ctx, cmd(in))
		if err != nil {
			return nil, err
		}
		if d, ok := b.Docs[in.ID]; ok {
			return *d, nil
		}
		return nil, nil
	}
}

func (h handler) moveLines(ctx context.Context, in MoveLines) (any, error) {
	_, err := h.x.Do(ctx, in)
	return nil, err
}

const (
	maxFollowUpSummary = 200
	maxFollowUpNotes   = 8000
)

// checkFollowUp is what the form may send: a summary short enough for a
// title, and notes that fit an event's description.
func checkFollowUp(d FollowUpDraft) error {
	switch {
	case d.ClientID == "":
		return apperr.Invalid("choose a client")
	case utf8.RuneCountInString(strings.TrimSpace(d.Summary)) > maxFollowUpSummary:
		return apperr.Invalid("keep the summary to %d characters; the rest goes in the notes", maxFollowUpSummary)
	case len(d.Notes) > maxFollowUpNotes:
		return apperr.Invalid("the notes are too long for a calendar event")
	}
	return nil
}

func (h handler) createFollowUp(ctx context.Context, in CreateFollowUp) (any, error) {
	if err := checkFollowUp(in.FollowUpDraft); err != nil {
		return nil, err
	}
	in.Notes = strings.TrimSpace(in.Notes)
	in.ID, in.Event, in.Problem = h.x.NewID(), nil, nil
	b, err := h.x.Do(ctx, in)
	if err != nil {
		return nil, err
	}
	return *b.FollowUps[in.ID], nil
}

func (h handler) updateFollowUp(ctx context.Context, in UpdateFollowUp) (any, error) {
	if err := checkFollowUp(in.FollowUpDraft); err != nil {
		return nil, err
	}
	in.Notes = strings.TrimSpace(in.Notes)
	in.FromCalendar, in.Seen, in.Problem = false, nil, nil
	b, err := h.x.Do(ctx, in)
	if err != nil {
		return nil, err
	}
	return *b.FollowUps[in.ID], nil
}

func (h handler) deleteFollowUp(ctx context.Context, in idInput) (any, error) {
	_, err := h.x.Do(ctx, DeleteFollowUp{ID: in.ID})
	return nil, err
}

func (h handler) setFollowUpDone(ctx context.Context, in SetFollowUpDone) (any, error) {
	b, err := h.x.Do(ctx, in)
	if err != nil {
		return nil, err
	}
	return *b.FollowUps[in.ID], nil
}

package billing

import (
	"cmp"
	"context"
	"maps"
	"slices"
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/shared/money"
)

// What a change in the app would bring on. Saving a booking, a package or a
// client's fees and names re-prices the client's sessions, and some may then
// need fixing: a session that loses its package credit and has no fee, one
// paid at a fee it no longer has. The previews list these before she saves,
// and the save refuses them unless she confirmed (Allowed). A change that
// would contradict an issued document is never allowed: what was issued
// must stay true.

// Brought is a contradiction a change would bring on a session or package
// that has none now.
type Brought struct {
	Kind  string    `json:"kind"`
	ID    string    `json:"id"`
	Start time.Time `json:"start"`
	Rule  string    `json:"rule"`
	// Problem says what she would have to fix.
	Problem string `json:"problem"`
}

// Brings lists the contradictions after holds that before doesn't: on an
// entity that has none in before. One that already needs fixing and would
// need fixing differently isn't new work.
func Brings(kind, id string, start time.Time, before, after []string, problem string) []Brought {
	if len(before) > 0 {
		return nil
	}
	out := make([]Brought, len(after))
	for i, rule := range after {
		out[i] = Brought{Kind: kind, ID: id, Start: start, Rule: rule, Problem: problem}
	}
	return out
}

// SessionContradictions are the Contradiction rules that hold for a session,
// whether or not a Stop rule hides them from the to-do list.
func SessionContradictions(s sessions.Session, now time.Time) []string {
	return holding(sessions.Rules, s.State(now))
}

// PackageContradictions are the Contradiction rules that hold for a
// package.
func PackageContradictions(p packages.Package, now time.Time) []string {
	return holding(packages.Rules, p.State(now))
}

func holding[S any](rules statemodel.Rules[S], s S) []string {
	var ids []string
	for _, r := range rules {
		if r.Bucket == statemodel.Contradiction && r.When(s) {
			ids = append(ids, r.ID)
		}
	}
	return ids
}

// Impact is what a form shows before saving: what saving would bring on,
// and whether that needs confirming or is refused anyway.
type Impact struct {
	Brings []Brought `json:"brings"`
	// NeedsConfirm says saving brings something on: the save refuses it
	// unless confirmed.
	NeedsConfirm bool `json:"needsConfirm"`
	// Refused says why saving is refused, confirmed or not: it would
	// contradict an issued document.
	Refused string `json:"refused,omitempty"`
	// NeedsFee says a booking needs its fee entered: its client has no
	// usual fee, and no package credit covers it (see Refused).
	NeedsFee bool `json:"needsFee,omitempty"`
	// NeedsClientFee is the client with no usual fee whose sessions it
	// would leave without one: setting one settles them all at once.
	NeedsClientFee string `json:"needsClientFee,omitempty"`
}

// ImpactOf is the impact of a change that brings these on: never allowed
// when it contradicts an issued document, and the rest once confirmed.
func ImpactOf(brought []Brought) Impact {
	out := Impact{Brings: brought, NeedsConfirm: len(brought) > 0}
	if out.Brings == nil {
		out.Brings = []Brought{}
	}
	for _, b := range brought {
		if b.Rule == contradictsDocument {
			out.Refused = b.Problem + ". Cancel the issued document first."
			break
		}
	}
	return out
}

// Check is the save's verdict: nil when it may go ahead.
func (i Impact) Check(confirmed bool) error {
	switch {
	case i.Refused != "":
		return apperr.Conflict("%s", i.Refused)
	case i.NeedsConfirm && !confirmed:
		return apperr.Conflict("%s. Confirm to save anyway, and fix it after.", i.Brings[0].Problem)
	}
	return nil
}

// contradictsDocument is the rule, on sessions and packages alike, that the
// calendar no longer says what an issued document does.
const contradictsDocument = "contradicts-document"

// book is what pricing some clients takes: their sessions and packages as
// stored.
type book struct {
	sessions map[string]sessions.Session
	packages map[string]packages.Package
	// buyers are the sessions that bought its calendar packages, where
	// another client's history (or none) holds them.
	buyers map[string]sessions.Session
}

// loadBook reads the clients' whole histories, and the sessions no client
// matches when unmatched is set.
func (r *Reconciler) loadBook(ctx context.Context, unmatched bool, clientIDs ...string) (book, error) {
	b := book{sessions: map[string]sessions.Session{}, packages: map[string]packages.Package{}}
	loaded := map[string]bool{"": true}
	for _, id := range slices.Compact(slices.Sorted(slices.Values(clientIDs))) {
		if loaded[id] {
			continue
		}
		loaded[id] = true
		history, err := r.Sessions.ListByClient(ctx, id)
		if err != nil {
			return b, err
		}
		for _, s := range history {
			b.sessions[s.EventID] = s
		}
		pkgs, err := r.Packages.ListByClient(ctx, id)
		if err != nil {
			return b, err
		}
		for _, p := range pkgs {
			b.packages[p.ID] = p
		}
	}
	if unmatched {
		all, err := r.Sessions.ListWithoutClient(ctx)
		if err != nil {
			return b, err
		}
		for _, s := range all {
			b.sessions[s.EventID] = s
		}
	}
	// A title that buys a package may have bought it under another client
	// (its name matched someone else before): their history too, as the
	// reconcile reads it.
	for _, s := range b.sessions {
		title, err := calendar.ParseTitle(s.Title)
		if _, have := b.packages[s.EventID]; err != nil || title.Package == nil || have {
			continue
		}
		p, found, err := r.Packages.Get(ctx, s.EventID)
		if err != nil {
			return b, err
		}
		if found && !loaded[p.ClientID] {
			loaded[p.ClientID] = true
			more, err := r.loadBook(ctx, false, p.ClientID)
			if err != nil {
				return b, err
			}
			maps.Copy(b.packages, more.packages)
			for id, s := range more.sessions {
				if _, have := b.sessions[id]; !have {
					b.sessions[id] = s
				}
			}
		}
	}
	b.buyers = map[string]sessions.Session{}
	for id, p := range b.packages {
		if _, loaded := b.sessions[id]; loaded || p.Source != packages.SourceCalendar {
			continue
		}
		s, found, err := r.Sessions.Get(ctx, id)
		if err != nil {
			return b, err
		}
		if found {
			b.buyers[id] = s
		}
	}
	return b, nil
}

// held are the book's calendar packages whose session it didn't load and
// whose title can't be told (see Reconciler.heldElsewhere).
func (b book) held(env Env) map[string]bool {
	out := map[string]bool{}
	for id, s := range b.buyers {
		if _, loaded := b.sessions[id]; !loaded && holds(Derive(s, env)) {
			out[id] = true
		}
	}
	return out
}

func (b book) clone() book {
	return book{sessions: maps.Clone(b.sessions), packages: maps.Clone(b.packages), buyers: b.buyers}
}

// priced is the book as the reconcile would write it, with env's clients
// and settings.
func (b book) priced(env Env) book {
	entries := make(map[string]*Entry, len(b.sessions))
	for id, s := range b.sessions {
		e := Derive(s, env)
		entries[id] = &e
	}
	final := linkPackages(entries, maps.Clone(b.packages), b.held(env))

	byClient := map[string][]*Entry{}
	for _, e := range entries {
		if e.Session.ClientID != "" {
			byClient[e.Session.ClientID] = append(byClient[e.Session.ClientID], e)
		}
	}
	pkgsByClient := map[string][]*packages.Package{}
	for _, p := range final {
		pkgsByClient[p.ClientID] = append(pkgsByClient[p.ClientID], p)
	}
	for _, id := range slices.Sorted(maps.Keys(env.Clients)) {
		if len(byClient[id]) > 0 || len(pkgsByClient[id]) > 0 {
			Allocate(env.Clients[id], byClient[id], pkgsByClient[id], env.Location)
		}
	}

	out := book{sessions: make(map[string]sessions.Session, len(entries)), packages: make(map[string]packages.Package, len(final))}
	for id, e := range entries {
		s := e.Session
		s.Drift = SessionDrift(s, env.Location)
		out.sessions[id] = s
	}
	for id, p := range final {
		q := *p
		q.Drift = PackageDrift(q, env.Location)
		out.packages[id] = q
	}
	return out
}

// brings lists what after brings on that before doesn't, by session and
// package, in date order.
func brings(before, after book, now time.Time) []Brought {
	var out []Brought
	for _, id := range slices.Sorted(maps.Keys(after.sessions)) {
		s := after.sessions[id]
		var was []string
		if b, ok := before.sessions[id]; ok {
			was = SessionContradictions(b, now)
		}
		out = append(out, Brings("session", id, s.Start, was, SessionContradictions(s, now), s.View(now).Problem)...)
	}
	for _, id := range slices.Sorted(maps.Keys(after.packages)) {
		p := after.packages[id]
		var was []string
		if b, ok := before.packages[id]; ok {
			was = PackageContradictions(b, now)
		}
		problem := p.View(now).Problem
		if problem == "" && p.Unlinked {
			problem = "The calendar no longer buys this package"
		}
		out = append(out, Brings("package", id, p.PurchasedAt, was, PackageContradictions(p, now), problem)...)
	}
	slices.SortStableFunc(out, func(a, b Brought) int { return a.Start.Compare(b.Start) })
	return out
}

func (r *Reconciler) env(ctx context.Context, all []clients.Client) (Env, error) {
	cfg, err := r.Settings.Get(ctx)
	if err != nil {
		return Env{}, err
	}
	return NewEnv(all, cfg, r.Location, r.now()), nil
}

// BookingImpact is what writing an event for a session would make of it,
// and bring on elsewhere: the session as the reconcile would derive it
// (zero EventID for a new one, previewed as "new"), and what it brings on.
// updatePayment moves what was paid for it, and for the package it buys, to
// the new amounts (payments.Reprice).
func (r *Reconciler) BookingImpact(ctx context.Context, eventID string, event calendar.Event, updatePayment bool) (sessions.Session, []Brought, error) {
	all, err := r.Clients.List(ctx)
	if err != nil {
		return sessions.Session{}, nil, err
	}
	env, err := r.env(ctx, all)
	if err != nil {
		return sessions.Session{}, nil, err
	}
	var stored sessions.Session
	if eventID != "" {
		if stored, _, err = r.Sessions.Get(ctx, eventID); err != nil {
			return sessions.Session{}, nil, err
		}
	}
	id := cmp.Or(eventID, "new")
	event.ID = id
	booked := withEvent(stored, event)

	// The package the event bought, under whichever client it is.
	var bought packages.Package
	if eventID != "" {
		if bought, _, err = r.Packages.Get(ctx, eventID); err != nil {
			return sessions.Session{}, nil, err
		}
	}
	b, err := r.loadBook(ctx, false, stored.ClientID, Derive(booked, env).Session.ClientID, bought.ClientID)
	if err != nil {
		return sessions.Session{}, nil, err
	}
	if eventID != "" && stored.EventID != "" {
		// As it is now, whoever it belongs to, if anyone.
		b.sessions[eventID] = stored
	}
	before := b.priced(env)
	b.sessions[id] = booked
	after := b.priced(env)
	if updatePayment {
		if s := after.sessions[id]; s.Payment.Outdated(s.DueCents()) {
			s.Payment = repriced(s.Payment, s.DueCents())
			after.sessions[id] = s
		}
		if p, ok := after.packages[id]; ok && p.Payment.Outdated(p.PriceCents) {
			p.Payment = repriced(p.Payment, p.PriceCents)
			after.packages[id] = p
		}
	}
	return after.sessions[id], brings(before, after, env.Now), nil
}

// repriced is a payment moved to a new amount due, as payments.Reprice
// writes it.
func repriced(p *money.Payment, dueCents int64) *money.Payment {
	out := *p
	out.AmountCents, out.DueCents = dueCents, dueCents
	return &out
}

// DeletionImpact is what deleting a session would bring on, with the
// package its title bought kept as a standalone one or, deletePackage,
// deleted too: sessions that lose or gain its credits.
func (r *Reconciler) DeletionImpact(ctx context.Context, eventID string, deletePackage bool) (Impact, error) {
	all, err := r.Clients.List(ctx)
	if err != nil {
		return Impact{}, err
	}
	env, err := r.env(ctx, all)
	if err != nil {
		return Impact{}, err
	}
	stored, _, err := r.Sessions.Get(ctx, eventID)
	if err != nil {
		return Impact{}, err
	}
	bought, found, err := r.Packages.Get(ctx, eventID)
	if err != nil {
		return Impact{}, err
	}
	b, err := r.loadBook(ctx, false, stored.ClientID, bought.ClientID)
	if err != nil {
		return Impact{}, err
	}
	if stored.EventID != "" {
		b.sessions[eventID] = stored
	}
	before := b.priced(env)
	delete(b.sessions, eventID)
	switch {
	case !found:
	case deletePackage:
		delete(b.packages, eventID)
	default:
		bought.Source, bought.Unlinked = packages.SourceApp, false
		b.packages[eventID] = bought
	}
	return ImpactOf(brings(before, b.priced(env), env.Now)), nil
}

// PackageImpact is what saving a package as next (nil deletes it) would
// bring on. A new one has no id yet. clientFee, when set, is the usual fee
// she gives its client(s) without one in the same save.
func (r *Reconciler) PackageImpact(ctx context.Context, id string, next *packages.Package, clientFee *int64) (Impact, error) {
	all, err := r.Clients.List(ctx)
	if err != nil {
		return Impact{}, err
	}
	env, err := r.env(ctx, all)
	if err != nil {
		return Impact{}, err
	}
	var stored packages.Package
	if id != "" {
		if stored, _, err = r.Packages.Get(ctx, id); err != nil {
			return Impact{}, err
		}
	}
	nextClient := ""
	if next != nil {
		nextClient = next.ClientID
	}
	b, err := r.loadBook(ctx, false, stored.ClientID, nextClient)
	if err != nil {
		return Impact{}, err
	}
	before := b.priced(env)
	delete(b.packages, id)
	if next != nil {
		p := *next
		p.ID = cmp.Or(p.ID, "new")
		b.packages[p.ID] = p
	}
	envAfter := env
	if clientFee != nil {
		envAfter.Clients = maps.Clone(env.Clients)
		for _, cid := range []string{stored.ClientID, nextClient} {
			if c, ok := envAfter.Clients[cid]; ok && len(c.FeeRates) == 0 {
				c.FeeRates = []clients.FeeRate{{Cents: *clientFee}}
				envAfter.Clients[cid] = c
			}
		}
	}
	after := b.priced(envAfter)
	out := ImpactOf(brings(before, after, env.Now))
	for _, br := range out.Brings {
		if s, ok := after.sessions[br.ID]; br.Kind == "session" && br.Rule == "fee-missing" && ok && len(envAfter.Clients[s.ClientID].FeeRates) == 0 {
			out.NeedsClientFee = s.ClientID
			break
		}
	}
	return out, nil
}

// ClientImpact is what saving a client as proposed (a new one has no id),
// as clients.Prepare makes it, would bring on: its fees re-price its
// sessions, and its names match or unmatch them.
func (r *Reconciler) ClientImpact(ctx context.Context, proposed clients.Client) ([]Brought, error) {
	all, err := r.Clients.List(ctx)
	if err != nil {
		return nil, err
	}
	envBefore, err := r.env(ctx, all)
	if err != nil {
		return nil, err
	}
	proposed.ID = cmp.Or(proposed.ID, "new")
	after := slices.DeleteFunc(slices.Clone(all), func(c clients.Client) bool { return c.ID == proposed.ID })
	envAfter, err := r.env(ctx, append(after, proposed))
	if err != nil {
		return nil, err
	}
	b, err := r.loadBook(ctx, true, proposed.ID)
	if err != nil {
		return nil, err
	}
	return brings(b.priced(envBefore), b.priced(envAfter), envBefore.Now), nil
}

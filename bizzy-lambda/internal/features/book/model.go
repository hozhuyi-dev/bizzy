// Package book is the only way sessions, packages, their documents and
// follow-ups change: each change is a Command, decided by one guard table
// and applied to one client's book (or two, when something moves between
// clients) in one transaction.
//
// A command is applied to a copy of the book; the guards compare the copy
// with the book as it was (see guards.go), so they judge what a command
// does, not what it says it does, and a new command can't slip past a rule
// it didn't think of. A command any guard refuses changes nothing. One that
// passes is completed by Derive, which writes every field an item copies
// from another (a session's fee from its invoice line, a package's credits
// from the sessions using them), checked against every invariant (see
// invariants.go), and committed.
//
// The app's actions and the calendar's edits are the same commands (a
// calendar edit is a sessions.update marked FromCalendar), so the calendar
// can do exactly what the app can, and nothing else. Follow-ups are the
// same: a client's, shown by an event, changed by commands.
package book

import (
	"cmp"
	"encoding/json"
	"maps"
	"slices"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/command"
)

// Book is the sessions, packages, documents and follow-ups of some clients,
// as read and as a command changes them.
type Book struct {
	Now      time.Time
	Location *time.Location
	Settings settings.Settings
	// Clients are every client: names, fees and calendar names are read
	// across them.
	Clients map[string]clients.Client
	// Loaded are the clients whose items are all here.
	Loaded    map[string]bool
	Sessions  map[string]*sessions.Session
	Packages  map[string]*packages.Package
	Docs      map[string]*documents.Document
	FollowUps map[string]*followups.FollowUp
	// Others are other clients' sessions around the times a command books,
	// read only: sessions never overlap, whoever's they are.
	Others map[string]sessions.Session
	// Counters are the last numbers issued, by sequence, and the slot
	// counters of the days read (see SlotKey), as read.
	Counters map[string]int64

	// What a change writes besides the items, collected as commands apply.
	Effects Effects

	// problems are what a command couldn't make sense of (an unreadable
	// title, a name no client has, no fee known, a step a document isn't
	// at), keyed by what it is about (see Key), for the guards to refuse.
	problems map[string]Problem
	newID    func() string
}

// Effects are the writes a change makes besides its items, and what
// follows once it is committed.
type Effects struct {
	// Externals are records on Google surfaces that now show something;
	// ExternalsGone those that show nothing any more.
	Externals     []conflicts.External `json:"externals,omitempty"`
	ExternalsGone []string             `json:"externalsGone,omitempty"`
	// ConflictsGone are conflicts the change settles, by key.
	ConflictsGone []string `json:"conflictsGone,omitempty"`
	// Revisions are issued; Counters take numbers; Shares make links.
	Revisions []documents.Revision    `json:"revisions,omitempty"`
	Counters  []documents.CounterBump `json:"counters,omitempty"`
	Shares    []Share                 `json:"shares,omitempty"`
	// EventsGone are the calendar events of sessions and follow-ups deleted
	// in the app, for the calendar to delete once committed.
	EventsGone []string `json:"eventsGone,omitempty"`
	// Rebooked are the sessions and follow-ups she changed in the app:
	// their events are written over any edit of hers waiting there (the
	// app's change settles it).
	Rebooked []string `json:"rebooked,omitempty"`
	// Purged are the sessions whose attached files go once committed.
	Purged []string `json:"purged,omitempty"`
}

// Share is a document's new share link.
type Share struct {
	DocumentID string                `json:"documentId"`
	Change     documents.ShareChange `json:"change"`
}

// ProblemKind is what a command couldn't make sense of.
type ProblemKind string

const (
	// Unreadable: a calendar title that doesn't follow the syntax.
	Unreadable ProblemKind = "unreadable"
	// Unmatched: a calendar title naming no client.
	Unmatched ProblemKind = "unmatched"
	// NoFee: nothing pays for the session: no fee given, no credit left
	// and no usual fee for the client.
	NoFee ProblemKind = "no-fee"
	// Unwritable: the client's name can't be written in a title (it ends
	// like an amount or a place, or has a colon for a follow-up).
	Unwritable ProblemKind = "unwritable"
	// NothingDue: a payment for something that owes nothing.
	NothingDue ProblemKind = "nothing-due"
	// Lifecycle: a document asked to take a step it isn't at.
	Lifecycle ProblemKind = "lifecycle"
)

// Key names what a problem is about: "session:<id>", "package:<id>",
// "document:<id>" or "followUp:<id>".
func Key(kind, id string) string { return kind + ":" + id }

// Problem is one thing a command couldn't make sense of.
type Problem struct {
	Kind ProblemKind
	// Text explains it, as the guard shows it.
	Text string
	// Name is the name in the title, and Suggested the client it nearly
	// matches.
	Name      string
	Suggested string
	// ClientID is the client a fee is missing for.
	ClientID string
	// EventID is the event the title is on, when it came from the calendar.
	EventID string
	// FollowUp says the title is a follow-up's, not a session's.
	FollowUp bool
}

// Loaded is what a store reads to make a book.
type Loaded struct {
	Settings settings.Settings
	Clients  []clients.Client
	// ClientIDs are the clients whose items are all below.
	ClientIDs []string
	Sessions  []sessions.Session
	Packages  []packages.Package
	Docs      []documents.Document
	FollowUps []followups.FollowUp
	Counters  map[string]int64
}

// New makes a book of what was loaded, as of now.
func New(l Loaded, now time.Time, loc *time.Location, newID func() string) *Book {
	b := &Book{
		Now: now, Location: loc, Settings: l.Settings,
		Clients: map[string]clients.Client{}, Loaded: map[string]bool{},
		Sessions: map[string]*sessions.Session{}, Packages: map[string]*packages.Package{},
		Docs: map[string]*documents.Document{}, FollowUps: map[string]*followups.FollowUp{},
		Others: map[string]sessions.Session{}, Counters: maps.Clone(l.Counters),
		problems: map[string]Problem{}, newID: newID,
	}
	if b.Counters == nil {
		b.Counters = map[string]int64{}
	}
	for _, c := range l.Clients {
		b.Clients[c.ID] = c
	}
	for _, id := range l.ClientIDs {
		b.Loaded[id] = true
	}
	for _, s := range l.Sessions {
		b.Sessions[s.ID] = ptr(s)
	}
	for _, p := range l.Packages {
		b.Packages[p.ID] = ptr(p)
	}
	for _, d := range l.Docs {
		b.Docs[d.ID] = ptr(d)
	}
	for _, f := range l.FollowUps {
		b.FollowUps[f.ID] = ptr(f)
	}
	return b
}

// Clone is a deep copy of the book, for a command to change.
func (b *Book) Clone() *Book {
	out := &Book{
		Now: b.Now, Location: b.Location, Settings: b.Settings,
		Clients: maps.Clone(b.Clients), Loaded: maps.Clone(b.Loaded),
		Sessions: cloneAll(b.Sessions), Packages: cloneAll(b.Packages), Docs: cloneAll(b.Docs),
		FollowUps: cloneAll(b.FollowUps), Others: maps.Clone(b.Others),
		Counters: maps.Clone(b.Counters), Effects: deepCopy(b.Effects),
		problems: maps.Clone(b.problems), newID: b.newID,
	}
	return out
}

func cloneAll[T any](m map[string]*T) map[string]*T {
	out := make(map[string]*T, len(m))
	for id, v := range m {
		out[id] = ptr(deepCopy(*v))
	}
	return out
}

// deepCopy copies a value through JSON, which every stored type survives.
func deepCopy[T any](v T) T {
	var out T
	b, err := json.Marshal(v)
	if err == nil {
		err = json.Unmarshal(b, &out)
	}
	if err != nil {
		panic("book: copy: " + err.Error())
	}
	return out
}

func ptr[T any](v T) *T { return &v }

// NewID is a new item id.
func (b *Book) NewID() string { return b.newID() }

// Problems are what the change couldn't make sense of, by Key.
func (b *Book) Problems() map[string]Problem { return b.problems }

func (b *Book) problem(key string, p Problem) {
	b.problems[key] = p
}

// Session returns a session, or the error to show when it is gone.
func (b *Book) Session(id string) (*sessions.Session, error) {
	s, ok := b.Sessions[id]
	if !ok {
		return nil, sessions.ErrGone
	}
	return s, nil
}

// Package returns a package, or the error to show when it is gone.
func (b *Book) Package(id string) (*packages.Package, error) {
	p, ok := b.Packages[id]
	if !ok {
		return nil, apperr.NotFound("This package was deleted.")
	}
	return p, nil
}

// Doc returns a document at the version she was looking at (0: any).
func (b *Book) Doc(id string, version int) (*documents.Document, error) {
	d, ok := b.Docs[id]
	switch {
	case !ok:
		return nil, apperr.NotFound("This document was deleted.")
	case version != 0 && d.Version != version:
		return nil, apperr.Conflict("This document changed elsewhere; reload it.")
	}
	return d, nil
}

// FollowUp returns a follow-up, or the error to show when it is gone.
func (b *Book) FollowUp(id string) (*followups.FollowUp, error) {
	f, ok := b.FollowUps[id]
	if !ok {
		return nil, followups.ErrGone
	}
	return f, nil
}

// Client returns a client.
func (b *Book) Client(id string) (clients.Client, error) {
	c, ok := b.Clients[id]
	if !ok {
		return c, apperr.NotFound("client not found")
	}
	return c, nil
}

// ClientOf is the client a session or follow-up here is for ("" when it
// isn't here).
func (b *Book) ClientOf(kind conflicts.ExternalKind, id string) string {
	if kind == conflicts.ShowsFollowUp {
		if f, ok := b.FollowUps[id]; ok {
			return f.ClientID
		}
		return ""
	}
	if s, ok := b.Sessions[id]; ok {
		return s.ClientID
	}
	return ""
}

// ClientSessions are a client's sessions here, oldest first.
func (b *Book) ClientSessions(clientID string) []*sessions.Session {
	var out []*sessions.Session
	for _, s := range b.Sessions {
		if s.ClientID == clientID {
			out = append(out, s)
		}
	}
	slices.SortFunc(out, func(a, c *sessions.Session) int {
		return cmp.Or(a.Start.Compare(c.Start), cmp.Compare(a.ID, c.ID))
	})
	return out
}

// ClientPackages are a client's packages here, oldest first.
func (b *Book) ClientPackages(clientID string) []*packages.Package {
	var out []*packages.Package
	for _, p := range b.Packages {
		if p.ClientID == clientID {
			out = append(out, p)
		}
	}
	slices.SortFunc(out, func(a, c *packages.Package) int {
		return cmp.Or(a.PurchasedAt.Compare(c.PurchasedAt), cmp.Compare(a.ID, c.ID))
	})
	return out
}

// Using are the sessions a package's credits cover, oldest first.
func (b *Book) Using(packageID string) []*sessions.Session {
	var out []*sessions.Session
	for _, s := range b.Sessions {
		if s.PackageID == packageID {
			out = append(out, s)
		}
	}
	slices.SortFunc(out, func(a, c *sessions.Session) int {
		return cmp.Or(a.Start.Compare(c.Start), cmp.Compare(a.ID, c.ID))
	})
	return out
}

// SortedIDs are a map's keys in order, so everything the book does is
// deterministic.
func SortedIDs[V any](m map[string]V) []string {
	return slices.Sorted(maps.Keys(m))
}

// LocalDate is the day a time falls on, in her time zone.
func (b *Book) LocalDate(t time.Time) string {
	return t.In(b.Location).Format(time.DateOnly)
}

// Command is a change to the book. Apply does what it asks to a copy of
// the book, whatever that breaks: the guards then compare the copy with
// the book as it was and refuse what isn't allowed, so Apply returns an
// error only for input that makes no sense (an unknown id, a malformed
// date) and records what it couldn't make sense of as a Problem.
type Command interface {
	command.Command
	// Scope is what the command touches, to load the book it needs.
	Scope() Scope
	Apply(b *Book) error
}

// Scope is what a command touches: the clients those items belong to are
// loaded whole.
type Scope struct {
	Sessions  []string
	Packages  []string
	Documents []string
	FollowUps []string
	Clients   []string
	// Numbering loads the document numbers issued so far this year.
	Numbering bool
}

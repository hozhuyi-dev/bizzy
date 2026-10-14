// Package integrity checks the state of everything at once: each entity
// against its own rule table (state.go and rules.go in its feature), the
// book's invariants across sessions, packages and documents (book), and
// the links the rules here check, which no single book can see: issued
// revisions and share links, what Google records show, and files.
//
// The simulation runs Check after every action; it reads only a World, so
// it can run against real data too.
package integrity

import (
	"time"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/book"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/expenses"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
)

// World is everything stored, as of Now.
type World struct {
	Settings  settings.Settings
	Clients   map[string]clients.Client
	Sessions  map[string]sessions.Session
	Packages  map[string]packages.Package
	FollowUps map[string]followups.FollowUp
	Documents map[string]documents.Document
	Revisions []documents.Revision
	// Shares maps each share token to the document it opens.
	Shares map[string]string
	// Conflicts and Externals are keyed as conflicts.Key.
	Conflicts map[string]conflicts.Conflict
	Externals map[string]conflicts.External
	// Attachments are keyed as the memory store keys them; Files says which
	// keys hold a file in blob storage, and whether it was confirmed (not
	// pending).
	Attachments map[string]attachments.Attachment
	Files       map[string]bool
	Expenses    map[string]expenses.Expense
	Items       map[string]expenses.Item
	Categories  []expenses.Category
	Location    *time.Location
	Now         time.Time
}

// Book is the world's sessions, packages, documents and follow-ups as one
// book, every client loaded.
func (w World) Book() *book.Book {
	l := book.Loaded{Settings: w.Settings, Counters: map[string]int64{}}
	for _, id := range sortedKeys(w.Clients) {
		l.Clients = append(l.Clients, w.Clients[id])
		l.ClientIDs = append(l.ClientIDs, id)
	}
	for _, s := range w.Sessions {
		l.Sessions = append(l.Sessions, s)
	}
	for _, p := range w.Packages {
		l.Packages = append(l.Packages, p)
	}
	for _, d := range w.Documents {
		l.Docs = append(l.Docs, d)
	}
	for _, f := range w.FollowUps {
		l.FollowUps = append(l.FollowUps, f)
	}
	loc := w.Location
	if loc == nil {
		loc = time.UTC
	}
	return book.New(l, w.Now, loc, func() string { return "check" })
}

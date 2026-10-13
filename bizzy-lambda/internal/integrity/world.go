// Package integrity checks the state of everything at once: each entity
// against its own rule table (state.go and rules.go in its feature), and
// the links between entities against the rules here, which no single
// entity can see. A link is stored on both sides (a document lists the
// sessions and packages it covers, and each of those points back at it),
// so each rule checks one direction, whatever the cardinality.
//
// The simulation runs Check after every action; it reads only a World, so
// it can run against real data too.
package integrity

import (
	"time"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/expenses"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
)

// World is everything stored, as of Now.
type World struct {
	Clients   map[string]clients.Client
	Sessions  map[string]sessions.Session
	Packages  map[string]packages.Package
	FollowUps map[string]followups.FollowUp
	Documents map[string]documents.Document
	Revisions []documents.Revision
	// Shares maps each share token to the document it opens.
	Shares map[string]string
	// Attachments are keyed as the memory store keys them; Files says which
	// keys hold a file in blob storage, and whether it was confirmed (not
	// pending).
	Attachments map[string]attachments.Attachment
	Files       map[string]bool
	Expenses    map[string]expenses.Expense
	Items       map[string]expenses.Item
	Categories  []expenses.Category
	Now         time.Time
}

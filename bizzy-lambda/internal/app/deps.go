// Package app wires every domain feature onto one router. The Lambda
// (cmd/api) builds it over DynamoDB and Google; the simulation
// (internal/simulation) builds the very same wiring over in-memory stores
// and fakes, so what the simulation checks is what runs in production.
//
// The Google connection and the data reset are not domain actions: they
// stay in cmd/api.
package app

import (
	"context"
	"time"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/book"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/expenses"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/recovery"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/features/todo"
	"bizzy-lambda/internal/platform/blobstore"
)

// Each store is everything the features ask of one repository.

type ClientStore interface {
	clients.HandlerStore
	googlesync.ClientStore
	contacts.ClientStore
}

type SessionStore interface {
	sessions.HandlerStore
	googlesync.SessionStore
	todo.Sessions
}

type FollowUpStore interface {
	followups.HandlerStore
	googlesync.FollowUpStore
	todo.FollowUps
}

type PackageStore interface {
	packages.HandlerStore
	todo.Packages
}

type ConflictStore interface {
	conflicts.HandlerStore
	googlesync.ConflictStore
}

type Deps struct {
	Clients    ClientStore
	Sessions   SessionStore
	FollowUps  FollowUpStore
	Packages   PackageStore
	Settings   settings.HandlerStore
	Documents  documents.Store
	Conflicts  ConflictStore
	Book       book.Store
	SyncStatus googlesync.StatusStore
	// Attachments are the files' items; Blobs the files themselves.
	Attachments attachments.Store
	Blobs       blobstore.Store
	Expenses    expenses.Store
	// Journal notes the mutations running; one left after StaleAfter (how
	// long a request can run) died, and the next sync repairs after it.
	Journal    recovery.Store
	StaleAfter time.Duration

	// Calendar opens the sessions calendar she chose.
	Calendar  func(ctx context.Context) (googlesync.Calendar, error)
	Directory contacts.Directory

	// Location is her time zone.
	Location *time.Location
	Now      func() time.Time
	// NewID makes ids; nil uses dynamo.NewID.
	NewID func() string
}

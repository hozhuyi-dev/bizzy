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
	"bizzy-lambda/internal/features/billing"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/expenses"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/payments"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/features/todo"
	"bizzy-lambda/internal/platform/blobstore"
)

// Each store is everything the features ask of one repository.

type ClientStore interface {
	clients.HandlerStore
	billing.ClientStore
	googlesync.ClientStore
	contacts.ClientStore
}

type SessionStore interface {
	sessions.HandlerStore
	billing.SessionStore
	googlesync.SessionStore
	googlesync.EditorSessions
	todo.Sessions
}

type FollowUpStore interface {
	followups.HandlerStore
	followups.RematchStore
	googlesync.FollowUpStore
	todo.FollowUps
}

type PackageStore interface {
	packages.HandlerStore
	billing.PackageStore
	todo.Packages
}

type Deps struct {
	Clients    ClientStore
	Sessions   SessionStore
	FollowUps  FollowUpStore
	Packages   PackageStore
	Settings   settings.HandlerStore
	Documents  documents.Store
	Payments   payments.Store
	SyncStatus googlesync.StatusHistory
	// Attachments are the files' items; Blobs the files themselves.
	Attachments attachments.Store
	Blobs       blobstore.Store
	Expenses    expenses.Store

	// Calendar opens the sessions calendar she chose.
	Calendar  func(ctx context.Context) (googlesync.Calendar, error)
	Directory contacts.Directory

	// Location is her time zone.
	Location *time.Location
	Now      func() time.Time
}

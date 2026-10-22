// Package app wires bizzy together: one Runner, the sync, and every
// feature's routes. cmd/api builds it on DynamoDB, S3 and Google; the
// tests and the simulation on the memory table and fakes.
//
// Adding a feature is three lines here: its routes, its invariants, and
// its kinds.
package app

import (
	"context"
	"time"

	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/features/activity"
	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/expenses"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/googleconnect"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/payments"
	"bizzy-lambda/internal/features/reset"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/features/timeline"
	"bizzy-lambda/internal/features/todo"
	"bizzy-lambda/internal/migrations"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
)

type Deps struct {
	Table table.Table
	// Blobs holds attached files.
	Blobs blobstore.Store
	// Google is the user's Google grant; nil leaves out the Settings
	// actions that connect it (tests).
	Google googleconnect.Auth
	// Calendar opens the calendar; nil opens the one the user connected.
	Calendar func(ctx context.Context) (calendar.Calendar, error)
	// Contacts is the user's Google contacts; nil reaches them with Google.
	Contacts contacts.Directory
	// Resettable serves data.reset (see features/reset): development and
	// staging only.
	Resettable bool
	// Location is the user's time zone.
	Location *time.Location
	Now      func() time.Time
	NewID    func() string
}

type App struct {
	Router *router.Router
	Runner *txn.Runner
	Sync   *googlesync.Sync
}

// Invariants are every feature's.
func Invariants() []txn.Invariant {
	var all []txn.Invariant
	for _, invs := range [][]txn.Invariant{
		clients.Invariants, settings.Invariants, documents.Invariants, packages.Invariants,
		attachments.Invariants, sessions.Invariants, followups.Invariants, expenses.Invariants,
		googlesync.Invariants,
	} {
		all = append(all, invs...)
	}
	return all
}

// Kinds are every kind stored, for checking every item (txn.CheckAll).
func Kinds() []txn.AnyKind {
	return []txn.AnyKind{
		clients.Clients, settings.Store,
		documents.Documents, documents.Links, documents.Revisions, documents.Shares, documents.Counters,
		packages.Packages, attachments.Attachments, sessions.Sessions, sessions.Notes, followups.FollowUps,
		expenses.Expenses, expenses.Items, expenses.Categories,
		conflicts.Conflicts, googlesync.Links, googlesync.States, googleconnect.Connections,
	}
}

func New(d Deps) *App {
	run := &txn.Runner{
		Table: d.Table, Invariants: Invariants(), Location: d.Location, Now: d.Now, NewID: d.NewID,
		Schema: migrations.Version,
	}
	if d.Calendar == nil {
		d.Calendar = googleconnect.Calendar(run, d.Google)
	}
	if d.Contacts == nil && d.Google != nil {
		d.Contacts = contacts.NewGoogle(d.Google.Client)
	}
	sync := &googlesync.Sync{Runner: run, Calendar: d.Calendar, Contacts: d.Contacts}
	run.After = sync.AfterCommit

	r := router.New()
	clients.Routes(r, run, contacts.Link(d.Contacts, d.Now),
		clients.Owner{What: "sessions", Has: sessions.Sessions.HasClient},
		clients.Owner{What: "packages", Has: packages.Packages.HasClient},
		clients.Owner{What: "documents", Has: documents.Documents.HasClient},
		clients.Owner{What: "follow-ups", Has: followups.FollowUps.HasClient})
	contacts.Routes(r, run, d.Contacts)
	settings.Routes(r, run)
	documents.Routes(r, run, d.Blobs, sessions.CheckIssue)
	packages.Routes(r, run, sessions.CreditsUsed)
	sessions.Routes(r, run, d.Blobs)
	payments.Routes(r, run)
	followups.Routes(r, run)
	attachments.Routes(r, run, d.Blobs, map[attachments.OwnerKind]attachments.Owner{
		attachments.OwnerSession: sessions.CanRecord,
		attachments.OwnerExpense: expenses.CanAttach,
	})
	expenses.Routes(r, run, d.Blobs)
	conflicts.Routes(r, run)
	todo.Routes(r, run, sessions.CreditsUsed)
	activity.Routes(r, run)
	timeline.Routes(r, run)
	googlesync.Routes(r, sync)
	if d.Google != nil {
		googleconnect.Routes(r, run, d.Google)
	}
	if d.Resettable {
		reset.Routes(r, d.Table, d.Blobs, sync)
	}
	return &App{Router: r, Runner: run, Sync: sync}
}

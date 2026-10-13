package app

import (
	"context"

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
	"bizzy-lambda/internal/router"
)

// App is the router with every domain action, the sync it runs, and the
// reconcile behind both.
type App struct {
	Router      *router.Router
	Sync        func(ctx context.Context, rng googlesync.Range) (googlesync.Summary, error)
	Reconciler  *billing.Reconciler
	Attachments attachments.Service
}

func New(d Deps) App {
	files := attachments.Service{
		Repo:  d.Attachments,
		Blobs: d.Blobs,
		Owners: map[attachments.OwnerKind]attachments.Owner{
			attachments.OwnerSession: sessions.Files{Repo: d.Sessions, Now: d.Now},
			attachments.OwnerExpense: expenses.Files{Repo: d.Expenses, Now: d.Now},
		},
		Now: d.Now,
	}
	reconciler := &billing.Reconciler{
		Clients:  d.Clients,
		Sessions: d.Sessions,
		Packages: d.Packages,
		Settings: d.Settings,
		Location: d.Location,
		Now:      d.Now,
		Purge: func(ctx context.Context, eventID string) error {
			return files.DeleteOwner(ctx, attachments.OwnerSession, eventID)
		},
	}
	reconcile := func(ctx context.Context, scope billing.Scope) error {
		_, err := reconciler.Reconcile(ctx, scope)
		return err
	}
	reconcileClients := func(ctx context.Context, ids ...string) error {
		return reconcile(ctx, billing.Scope{ClientIDs: ids})
	}

	r := router.New()

	// A saved client's aliases can match (or unmatch) sessions and
	// follow-ups, not just at the next sync.
	clients.Register(r, d.Clients, contacts.Linker{Dir: d.Directory, Now: d.Now}, func(ctx context.Context, id string) error {
		if err := reconcile(ctx, billing.Scope{ClientIDs: []string{id}, Unmatched: true}); err != nil {
			return err
		}
		all, err := d.Clients.List(ctx)
		if err != nil {
			return err
		}
		return followups.Rematch(ctx, d.FollowUps, all, id)
	}, d.Location, d.Now)
	contacts.Register(r, d.Directory, d.Clients, d.Now)
	billing.Register(r, reconciler)
	sessions.Register(r, d.Sessions, d.Now)
	attachments.Register(r, files)
	expenses.Register(r, expenses.Service{
		Repo: d.Expenses,
		AfterDelete: func(ctx context.Context, id string) error {
			return files.DeleteOwner(ctx, attachments.OwnerExpense, id)
		},
		Now: d.Now,
	})
	payments.Register(r, d.Payments, reconcileClients, d.Location, d.Now)
	followups.Register(r, d.FollowUps, d.Now)
	todo.Register(r, d.Sessions, d.Packages, d.FollowUps, d.Settings, d.Now)
	googlesync.RegisterEditor(r, googlesync.Editor{
		Calendar: d.Calendar,
		Clients:  d.Clients,
		Sessions: d.Sessions,
		Settings: d.Settings,
		Billing:  reconciler,
		Now:      d.Now,
	})
	googlesync.RegisterFollowUpEditor(r, googlesync.FollowUpEditor{
		Calendar:  d.Calendar,
		Clients:   d.Clients,
		FollowUps: d.FollowUps,
		Location:  d.Location,
	})
	packages.Register(r, d.Packages, reconcileClients, d.Location, d.Now)
	settings.Register(r, d.Settings, func(ctx context.Context) error {
		return reconcile(ctx, billing.Scope{AllClients: true, Unmatched: true})
	})
	documents.Register(r, documents.Deps{
		Repo:     d.Documents,
		Sessions: d.Sessions,
		Packages: d.Packages,
		Clients:  d.Clients,
		Settings: d.Settings,
		// A session the document covers may match no client by now (the
		// calendar renamed it), and its drift must still clear.
		AfterChange: func(ctx context.Context, ids ...string) error {
			return reconcile(ctx, billing.Scope{ClientIDs: ids, Unmatched: true})
		},
		Location: d.Location,
		Now:      d.Now,
	})

	sync := func(ctx context.Context, rng googlesync.Range) (googlesync.Summary, error) {
		cal, err := d.Calendar(ctx)
		if err != nil {
			return googlesync.Summary{}, err
		}
		return googlesync.Syncer{
			Events:    cal,
			Contacts:  d.Directory,
			Clients:   d.Clients,
			Sessions:  d.Sessions,
			FollowUps: d.FollowUps,
			Billing:   reconciler,
			Status:    d.SyncStatus,
			Location:  d.Location,
			Now:       d.Now,
		}.Run(ctx, rng)
	}
	googlesync.Register(r, d.SyncStatus, d.Location, sync, d.Now)

	return App{Router: r, Sync: sync, Reconciler: reconciler, Attachments: files}
}

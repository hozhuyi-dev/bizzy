package app

import (
	"context"
	"log/slog"

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
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

// App is the router with every domain action, the sync it runs, and the
// book behind both.
type App struct {
	Router      *router.Router
	Sync        func(ctx context.Context, rng googlesync.Range) (googlesync.Summary, error)
	Book        book.Executor
	Syncer      *googlesync.Syncer
	Attachments attachments.Service
	// RederiveAll writes what every client's items copy as it is now.
	RederiveAll func(ctx context.Context) error
}

func New(d Deps) App {
	newID := d.NewID
	if newID == nil {
		newID = func() string { return dynamo.NewID() }
	}
	// The syncer is built below; what she records on a session may change
	// what an edit waiting in the calendar is refused for.
	var syncer *googlesync.Syncer
	recorded := func(ctx context.Context, _ string) error { return syncer.Recheck(ctx) }
	files := attachments.Service{
		Repo:  d.Attachments,
		Blobs: d.Blobs,
		Owners: map[attachments.OwnerKind]attachments.Owner{
			attachments.OwnerSession: sessions.Files{Repo: d.Sessions, Now: d.Now, After: recorded},
			attachments.OwnerExpense: expenses.Files{Repo: d.Expenses, Now: d.Now},
		},
		Now: d.Now,
	}

	// The book runs every change to sessions, packages, documents and
	// follow-ups; the syncer reads the calendar into it, and writes it
	// back to the calendar once a change is committed.
	syncer = &googlesync.Syncer{
		Calendar: d.Calendar, Contacts: d.Directory, Clients: d.Clients, Sessions: d.Sessions,
		FollowUps: d.FollowUps, Conflicts: d.Conflicts, Status: d.SyncStatus, Location: d.Location, Now: d.Now,
	}
	purge := func(ctx context.Context, sessionID string) error {
		return files.DeleteOwner(ctx, attachments.OwnerSession, sessionID)
	}
	executor := book.Executor{
		Store: d.Book, Location: d.Location, Now: d.Now, NewID: newID,
		After: func(ctx context.Context, c book.Change) error { return syncer.After(purge)(ctx, c) },
	}
	syncer.Book = executor

	rederiveAll := func(ctx context.Context) error {
		all, err := d.Clients.List(ctx)
		if err != nil {
			return err
		}
		ids := make([]string, len(all))
		for i, c := range all {
			ids[i] = c.ID
		}
		return executor.Rederive(ctx, ids...)
	}

	r := router.New()
	r.Journal = recovery.Journal{Store: d.Journal, NewID: newID, Now: d.Now}
	// What a request that died partway can leave, put right.
	healer := recovery.Healer{
		Store:      d.Journal,
		StaleAfter: d.StaleAfter,
		Now:        d.Now,
		Repairs: []func(ctx context.Context) error{
			rederiveAll,
			syncer.PushPending,
			files.Heal,
		},
	}

	clients.Register(r, d.Clients, contacts.Linker{Dir: d.Directory, Now: d.Now}, func(ctx context.Context, id string) error {
		// New fees reach what isn't invoiced or paid yet.
		// (Its sessions' and follow-ups' events are written with a new name
		// or usual place by the same change.)
		if _, err := executor.Do(ctx, book.RepriceDrafts{ClientID: id}); err != nil {
			return err
		}
		// A new calendar name may make an edit waiting there readable.
		if err := syncer.Recheck(ctx); err != nil {
			slog.ErrorContext(ctx, "recheck the calendar", "error", err)
		}
		return nil
	}, d.Location, d.Now)
	contacts.Register(r, d.Directory, d.Clients, d.Now)
	sessions.Register(r, d.Sessions, executor.JudgeSessions, recorded, d.Now)
	packages.Register(r, d.Packages, executor.JudgePackages, d.Now)
	book.Register(r, executor, d.Sessions)
	attachments.Register(r, files)
	expenses.Register(r, expenses.Service{
		Repo: d.Expenses,
		AfterDelete: func(ctx context.Context, id string) error {
			return files.DeleteOwner(ctx, attachments.OwnerExpense, id)
		},
		Now: d.Now,
	})
	followups.Register(r, d.FollowUps)
	googlesync.RegisterConflicts(r, *syncer)
	conflicts.Register(r, d.Conflicts)
	todo.Register(r, todo.Deps{
		Sessions: d.Sessions, Packages: d.Packages, FollowUps: d.FollowUps, Conflicts: d.Conflicts, Settings: d.Settings,
		JudgeSessions: executor.JudgeSessions, JudgePackages: executor.JudgePackages, Now: d.Now,
	})
	settings.Register(r, d.Settings)
	documents.Register(r, documents.Deps{Repo: d.Documents, Clients: d.Clients, Settings: d.Settings})

	sync := func(ctx context.Context, rng googlesync.Range) (googlesync.Summary, error) {
		if _, err := healer.Heal(ctx, router.EntryOf(ctx)); err != nil {
			return googlesync.Summary{}, err
		}
		return syncer.Run(ctx, rng)
	}
	googlesync.Register(r, d.SyncStatus, d.Location, sync, d.Now)

	return App{Router: r, Sync: sync, Book: executor, Syncer: syncer, Attachments: files, RederiveAll: rederiveAll}
}

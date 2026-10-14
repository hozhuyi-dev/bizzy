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
	"bizzy-lambda/internal/features/recovery"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/features/todo"
	"bizzy-lambda/internal/platform/dynamo"
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
	r.Journal = recovery.Journal{Store: d.Journal, NewID: dynamo.NewID, Now: d.Now}
	// What a request that died partway can leave, put right.
	healer := recovery.Healer{
		Store:      d.Journal,
		StaleAfter: d.StaleAfter,
		Now:        d.Now,
		Repairs: []func(ctx context.Context) error{
			func(ctx context.Context) error {
				return reconcile(ctx, billing.Scope{AllClients: true, Unmatched: true})
			},
			func(ctx context.Context) error {
				all, err := d.Clients.List(ctx)
				for _, c := range all {
					if err == nil {
						err = followups.Rematch(ctx, d.FollowUps, all, c.ID)
					}
				}
				return err
			},
			files.Heal,
		},
	}

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
	}, clientImpact{reconciler}, d.Location, d.Now)
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
	editor := googlesync.Editor{
		Calendar: d.Calendar,
		Clients:  d.Clients,
		Sessions: d.Sessions,
		Settings: d.Settings,
		Billing:  reconciler,
		Payments: d.Payments,
		Packages: d.Packages,
		Now:      d.Now,
	}
	// What she pays, she pays as the calendar says now.
	payments.Register(r, d.Payments, reconcileClients, editor.Refresh, func(ctx context.Context, ids ...string) error {
		changes := make([]billing.Change, len(ids))
		for i, id := range ids {
			changes[i] = billing.Change{EventID: id}
		}
		return reconcile(ctx, billing.Scope{Changes: changes})
	}, d.Location, d.Now)
	followups.Register(r, d.FollowUps, d.Now)
	todo.Register(r, d.Sessions, d.Packages, d.FollowUps, d.Settings, d.Now)
	googlesync.RegisterEditor(r, editor)
	googlesync.RegisterFollowUpEditor(r, googlesync.FollowUpEditor{
		Calendar:  d.Calendar,
		Clients:   d.Clients,
		FollowUps: d.FollowUps,
		Location:  d.Location,
	})
	packages.Register(r, d.Packages, func(ctx context.Context, packageID string, clientIDs ...string) error {
		return reconcile(ctx, billing.Scope{ClientIDs: clientIDs, EventIDs: []string{packageID}})
	}, packageImpact{reconciler}, setClientFee(d.Clients), editor.Refresh, d.Location, d.Now)
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
		Refresh:  editor.Refresh,
		Location: d.Location,
		Now:      d.Now,
	})

	sync := func(ctx context.Context, rng googlesync.Range) (googlesync.Summary, error) {
		if _, err := healer.Heal(ctx, router.EntryOf(ctx)); err != nil {
			return googlesync.Summary{}, err
		}
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

// clientImpact and packageImpact give the clients and packages features
// billing's impact, which they can't import.
type clientImpact struct{ r *billing.Reconciler }

func (i clientImpact) Preview(ctx context.Context, proposed clients.Client) (any, error) {
	brought, err := i.r.ClientImpact(ctx, proposed)
	return billing.ImpactOf(brought), err
}

func (i clientImpact) Check(ctx context.Context, proposed clients.Client, confirmed bool) error {
	brought, err := i.r.ClientImpact(ctx, proposed)
	if err != nil {
		return err
	}
	return billing.ImpactOf(brought).Check(confirmed)
}

type packageImpact struct{ r *billing.Reconciler }

func (i packageImpact) Preview(ctx context.Context, id string, next *packages.Package, clientFee *int64) (any, error) {
	return i.r.PackageImpact(ctx, id, next, clientFee)
}

func (i packageImpact) Check(ctx context.Context, id string, next *packages.Package, clientFee *int64, confirmed bool) error {
	impact, err := i.r.PackageImpact(ctx, id, next, clientFee)
	if err != nil {
		return err
	}
	return impact.Check(confirmed)
}

// setClientFee gives a client with no usual fee one, from a package's
// form (packages.Impact.NeedsClientFee).
func setClientFee(store ClientStore) packages.SetClientFee {
	return func(ctx context.Context, clientID string, cents int64) error {
		c, found, err := store.Get(ctx, clientID)
		if err != nil || !found || len(c.FeeRates) > 0 {
			return err
		}
		c.FeeRates = []clients.FeeRate{{Cents: cents}}
		return store.SaveProfile(ctx, c)
	}
}

// Command api is the Lambda the web app invokes directly with identity-pool
// credentials. Every request is an {action, payload} pair; see router.
package main

import (
	"context"
	"log"
	"os"
	"time"
	_ "time/tzdata"

	"github.com/aws/aws-lambda-go/lambda"

	"bizzy-lambda/internal/features/billing"
	"bizzy-lambda/internal/features/calsync"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

func main() {
	store, err := dynamo.New(context.Background())
	if err != nil {
		log.Fatal(err)
	}
	loc, err := time.LoadLocation(os.Getenv("TIME_ZONE"))
	if err != nil {
		log.Fatalf("TIME_ZONE: %v", err)
	}

	clientsRepo := clients.NewRepository(store)
	sessionsRepo := sessions.NewRepository(store)
	packagesRepo := packages.NewRepository(store)
	settingsRepo := settings.NewRepository(store)

	reconciler := &billing.Reconciler{
		Clients:  clientsRepo,
		Sessions: sessionsRepo,
		Packages: packagesRepo,
		Settings: settingsRepo,
		Location: loc,
	}
	reconcile := func(ctx context.Context, scope billing.Scope) error {
		_, err := reconciler.Reconcile(ctx, scope)
		return err
	}
	reconcileClients := func(ctx context.Context, ids ...string) error {
		return reconcile(ctx, billing.Scope{ClientIDs: ids})
	}

	r := router.New()

	clients.Register(r, clientsRepo, func(ctx context.Context, id string) error {
		return reconcile(ctx, billing.Scope{ClientIDs: []string{id}, Unmatched: true})
	})
	sessions.Register(r, sessionsRepo, func(ctx context.Context, before, after sessions.Session) error {
		return reconcile(ctx, billing.Scope{Changes: []billing.Change{{Before: &before, After: &after}}})
	})
	packages.Register(r, packagesRepo, reconcileClients)
	settings.Register(r, settingsRepo, documents.ValidateTemplate, func(ctx context.Context) error {
		return reconcile(ctx, billing.Scope{AllClients: true, Unmatched: true})
	})
	documents.Register(r, documents.Deps{
		Repo:        documents.NewRepository(store),
		Sessions:    sessionsRepo,
		Packages:    packagesRepo,
		Clients:     clientsRepo,
		Settings:    settingsRepo,
		AfterChange: reconcileClients,
		Location:    loc,
		Now:         time.Now,
	})
	calsync.RegisterStatus(r, calsync.NewStatusRepository(store))

	lambda.Start(r.Handle)
}

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
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/google"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/payments"
	"bizzy-lambda/internal/features/reset"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/features/todo"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/googleauth"
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

	auth := googleauth.New(
		mustEnv("GOOGLE_CLIENT_ID"),
		mustEnv("GOOGLE_CLIENT_SECRET"),
		googleauth.ParamTokens(mustEnv("GOOGLE_TOKEN_PARAM")),
	)
	directory := contacts.NewGoogle(auth.Client)
	connections := google.NewRepository(store)

	clientsRepo := clients.NewRepository(store)
	sessionsRepo := sessions.NewRepository(store)
	followUpsRepo := followups.NewRepository(store)
	packagesRepo := packages.NewRepository(store)
	settingsRepo := settings.NewRepository(store)

	reconciler := &billing.Reconciler{
		Clients:  clientsRepo,
		Sessions: sessionsRepo,
		Packages: packagesRepo,
		Settings: settingsRepo,
		Location: loc,
		Now:      time.Now,
	}
	reconcile := func(ctx context.Context, scope billing.Scope) error {
		_, err := reconciler.Reconcile(ctx, scope)
		return err
	}
	reconcileClients := func(ctx context.Context, ids ...string) error {
		return reconcile(ctx, billing.Scope{ClientIDs: ids})
	}

	r := router.New()

	clients.Register(r, clientsRepo, contacts.Linker{Dir: directory, Now: time.Now}, func(ctx context.Context, id string) error {
		return reconcile(ctx, billing.Scope{ClientIDs: []string{id}, Unmatched: true})
	})
	contacts.Register(r, directory, clientsRepo)
	google.Register(r, connections, auth)
	sessions.Register(r, sessionsRepo)
	payments.Register(r, payments.NewRepository(store, sessionsRepo, packagesRepo), reconcileClients, loc)
	followups.Register(r, followUpsRepo)
	todo.Register(r, sessionsRepo, packagesRepo, followUpsRepo, settingsRepo)
	calendar := func(ctx context.Context) (googlesync.Calendar, error) {
		return connections.Calendar(ctx, auth.Client)
	}
	googlesync.RegisterEditor(r, googlesync.Editor{
		Calendar: calendar,
		Clients:  clientsRepo,
		Sessions: sessionsRepo,
		Settings: settingsRepo,
		Billing:  reconciler,
	})
	googlesync.RegisterFollowUpEditor(r, googlesync.FollowUpEditor{
		Calendar:  calendar,
		Clients:   clientsRepo,
		FollowUps: followUpsRepo,
		Location:  loc,
	})
	packages.Register(r, packagesRepo, reconcileClients, loc)
	settings.Register(r, settingsRepo, func(ctx context.Context) error {
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
	status := googlesync.NewStatusRepository(store)
	runSync := func(ctx context.Context, rng googlesync.Range) (googlesync.Summary, error) {
		cal, err := calendar(ctx)
		if err != nil {
			return googlesync.Summary{}, err
		}
		return googlesync.Syncer{
			Events:    cal,
			Contacts:  directory,
			Clients:   clientsRepo,
			Sessions:  sessionsRepo,
			FollowUps: followUpsRepo,
			Billing:   reconciler,
			Status:    status,
			Location:  loc,
			Now:       time.Now,
		}.Run(ctx, rng)
	}
	googlesync.Register(r, status, loc, runSync)
	// Keeps the Google connection, so a full sync rebuilds everything at once.
	if reset.Allowed(os.Getenv("ENVIRONMENT")) {
		reset.Register(r, store, func(ctx context.Context) (any, error) {
			return runSync(ctx, googlesync.Range{})
		}, google.Partition)
	}

	lambda.Start(r.Handle)
}

func mustEnv(name string) string {
	value := os.Getenv(name)
	if value == "" {
		log.Fatalf("%s is not set", name)
	}
	return value
}

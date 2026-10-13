// Command api is the Lambda the web app invokes directly with identity-pool
// credentials. Every request is an {action, payload} pair; see router. The
// domain actions are wired in internal/app.
package main

import (
	"context"
	"log"
	"os"
	"time"
	_ "time/tzdata"

	"github.com/aws/aws-lambda-go/lambda"

	"bizzy-lambda/internal/app"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/googleconnect"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/payments"
	"bizzy-lambda/internal/features/reset"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/googleauth"
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
	connections := googleconnect.NewRepository(store)

	sessionsRepo := sessions.NewRepository(store)
	packagesRepo := packages.NewRepository(store)
	a := app.New(app.Deps{
		Clients:    clients.NewRepository(store),
		Sessions:   sessionsRepo,
		FollowUps:  followups.NewRepository(store),
		Packages:   packagesRepo,
		Settings:   settings.NewRepository(store),
		Documents:  documents.NewRepository(store),
		Payments:   payments.NewRepository(store, sessionsRepo, packagesRepo),
		SyncStatus: googlesync.NewStatusRepository(store),
		Calendar: func(ctx context.Context) (googlesync.Calendar, error) {
			return connections.Calendar(ctx, auth.Client)
		},
		Directory: directory,
		Location:  loc,
		Now:       time.Now,
	})
	r := a.Router

	googleconnect.Register(r, connections, auth)
	// Keeps the Google connection, so a full sync rebuilds everything at once.
	if reset.Allowed(os.Getenv("ENVIRONMENT")) {
		reset.Register(r, store, func(ctx context.Context) (any, error) {
			return a.Sync(ctx, googlesync.Range{})
		}, googleconnect.Partition)
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

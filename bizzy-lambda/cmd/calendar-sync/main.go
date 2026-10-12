// Command calendar-sync runs once a day on a schedule, and whenever she taps
// "Sync now" in the app. It imports the last SYNC_WINDOW_DAYS of calendar
// events as sessions and refreshes each client's copy of their Google
// contact, acting as her through the grant she made in Settings.
//
// It replies like the API ({data} or {error}), so the app can tell "Google
// is disconnected" from a crash.
package main

import (
	"context"
	"errors"
	"log"
	"log/slog"
	"os"
	"strconv"
	"time"
	_ "time/tzdata"

	"github.com/aws/aws-lambda-go/lambda"

	"bizzy-lambda/internal/features/billing"
	"bizzy-lambda/internal/features/calsync"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/google"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/googleauth"
	"bizzy-lambda/internal/router"
)

func main() {
	ctx := context.Background()

	store, err := dynamo.New(ctx)
	if err != nil {
		log.Fatal(err)
	}

	loc, err := time.LoadLocation(mustEnv("TIME_ZONE"))
	if err != nil {
		log.Fatalf("TIME_ZONE: %v", err)
	}

	auth := googleauth.New(
		mustEnv("GOOGLE_CLIENT_ID"),
		mustEnv("GOOGLE_CLIENT_SECRET"),
		googleauth.ParamTokens(mustEnv("GOOGLE_TOKEN_PARAM")),
	)
	connections := google.NewRepository(store)

	days, err := strconv.Atoi(os.Getenv("SYNC_WINDOW_DAYS"))
	if err != nil || days < 1 {
		days = 30
	}

	clientsRepo := clients.NewRepository(store)
	sessionsRepo := sessions.NewRepository(store)
	status := calsync.NewStatusRepository(store)

	base := calsync.Syncer{
		Contacts: contacts.NewGoogle(auth.Client),
		Clients:  clientsRepo,
		Sessions: sessionsRepo,
		Billing: &billing.Reconciler{
			Clients:  clientsRepo,
			Sessions: sessionsRepo,
			Packages: packages.NewRepository(store),
			Settings: settings.NewRepository(store),
			Location: loc,
		},
		Status:    status,
		Window:    time.Duration(days) * 24 * time.Hour,
		Lookahead: calsync.BookingLookahead,
		Now:       time.Now,
	}

	run := func(ctx context.Context) (calsync.Summary, error) {
		cal, err := connections.Calendar(ctx, auth.Client)
		if err != nil {
			return calsync.Summary{}, err
		}
		syncer := base
		syncer.Events = cal
		return syncer.Run(ctx)
	}

	lambda.Start(func(ctx context.Context) (router.Response, error) {
		summary, err := run(ctx)
		if err == nil {
			slog.InfoContext(ctx, "calendar sync", "summary", summary)
			return router.Response{Data: summary}, nil
		}

		slog.ErrorContext(ctx, "calendar sync failed", "error", err)
		body := &router.ErrorBody{Code: "internal", Message: "The sync failed. Please try again."}
		var appErr *apperr.Error
		if errors.As(err, &appErr) {
			body = &router.ErrorBody{Code: appErr.Code, Message: appErr.Message}
		}
		// Recorded so the app shows why, including for the nightly run.
		if putErr := status.Put(ctx, calsync.Run{At: time.Now().UTC(), Error: body.Message}); putErr != nil {
			slog.ErrorContext(ctx, "record sync failure", "error", putErr)
		}
		return router.Response{Error: body}, nil
	})
}

func mustEnv(name string) string {
	value := os.Getenv(name)
	if value == "" {
		log.Fatalf("%s is not set", name)
	}
	return value
}

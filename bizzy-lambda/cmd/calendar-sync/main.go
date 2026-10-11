// Command calendar-sync runs once a day on a schedule, and whenever she taps
// "Sync now" in the app, and imports the last SYNC_WINDOW_DAYS of calendar
// events as sessions.
package main

import (
	"context"
	"log"
	"log/slog"
	"os"
	"strconv"
	"time"
	_ "time/tzdata"

	"github.com/aws/aws-lambda-go/lambda"

	"bizzy-lambda/internal/features/billing"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/calsync"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/ssm"
)

// lookahead is how far ahead the sync looks for bookings, so a client who
// has rebooked is not suggested for a follow-up.
const lookahead = 60 * 24 * time.Hour

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

	key, err := ssm.SecureString(ctx, mustEnv("GOOGLE_SERVICE_ACCOUNT_PARAM"))
	if err != nil {
		log.Fatal(err)
	}

	source, err := calendar.NewGoogleSource(ctx, []byte(key), mustEnv("GOOGLE_CALENDAR_ID"))
	if err != nil {
		log.Fatal(err)
	}

	days, err := strconv.Atoi(os.Getenv("SYNC_WINDOW_DAYS"))
	if err != nil || days < 1 {
		days = 30
	}

	clientsRepo := clients.NewRepository(store)
	sessionsRepo := sessions.NewRepository(store)

	syncer := calsync.Syncer{
		Events:   source,
		Clients:  clientsRepo,
		Sessions: sessionsRepo,
		Billing: &billing.Reconciler{
			Clients:  clientsRepo,
			Sessions: sessionsRepo,
			Packages: packages.NewRepository(store),
			Settings: settings.NewRepository(store),
			Location: loc,
		},
		Status:    calsync.NewStatusRepository(store),
		Window:    time.Duration(days) * 24 * time.Hour,
		Lookahead: lookahead,
		Now:       time.Now,
	}

	lambda.Start(func(ctx context.Context) (calsync.Summary, error) {
		summary, err := syncer.Run(ctx)
		if err != nil {
			return summary, err
		}
		slog.InfoContext(ctx, "calendar sync", "summary", summary)
		return summary, nil
	})
}

func mustEnv(name string) string {
	value := os.Getenv(name)
	if value == "" {
		log.Fatalf("%s is not set", name)
	}
	return value
}

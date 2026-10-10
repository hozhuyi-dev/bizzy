// Command calendar-sync runs once a day on a schedule and imports the last
// SYNC_WINDOW_DAYS of calendar events as sessions.
package main

import (
	"context"
	"log"
	"log/slog"
	"os"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/lambda"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/ssm"
)

func main() {
	ctx := context.Background()

	store, err := dynamo.New(ctx)
	if err != nil {
		log.Fatal(err)
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

	syncer := calendar.Syncer{
		Events:  source,
		Clients: clients.NewRepository(store),
		Window:  time.Duration(days) * 24 * time.Hour,
		Now:     time.Now,
	}

	lambda.Start(func(ctx context.Context) (calendar.Summary, error) {
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

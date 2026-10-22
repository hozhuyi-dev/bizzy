// Command api is the Lambda the web app invokes directly with
// identity-pool credentials. Every request is an {action, payload} pair
// (see platform/router); internal/app wires the actions.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"os"
	"strconv"
	"time"
	_ "time/tzdata"

	"github.com/aws/aws-lambda-go/lambda"

	"bizzy-lambda/internal/app"
	"bizzy-lambda/internal/features/reset"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/googleauth"
)

func main() {
	tb, err := dynamo.New(context.Background())
	if err != nil {
		log.Fatal(err)
	}
	loc, err := time.LoadLocation(mustEnv("TIME_ZONE"))
	if err != nil {
		log.Fatalf("TIME_ZONE: %v", err)
	}
	google := googleauth.New(
		mustEnv("GOOGLE_CLIENT_ID"),
		mustEnv("GOOGLE_CLIENT_SECRET"),
		googleauth.ParamTokens(mustEnv("GOOGLE_TOKEN_PARAM")),
	)
	blobs, err := blobstore.NewS3(context.Background(), mustEnv("BUCKET_NAME"))
	if err != nil {
		log.Fatal(err)
	}
	// Production locks issued PDFs for as long as the tax law asks.
	if days := os.Getenv("RECORD_RETENTION_DAYS"); days != "" {
		n, err := strconv.Atoi(days)
		if err != nil {
			log.Fatalf("RECORD_RETENTION_DAYS: %v", err)
		}
		blobs.RecordRetention = time.Duration(n) * 24 * time.Hour
	}
	a := app.New(app.Deps{
		Table: tb, Blobs: blobs, Google: google, Resettable: reset.Allowed(os.Getenv("ENVIRONMENT")),
		Location: loc, Now: time.Now, NewID: newID, Parallel: googleParallel,
	})
	a.Router.LogRequests = true
	lambda.Start(a.Router.Handle)
}

// googleParallel is how many calls to Google Calendar run at once: each
// takes a few hundred milliseconds, mostly waiting.
const googleParallel = 4

// newID is a random 16-character hex id.
func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func mustEnv(name string) string {
	v := os.Getenv(name)
	if v == "" {
		log.Fatalf("%s is not set", name)
	}
	return v
}

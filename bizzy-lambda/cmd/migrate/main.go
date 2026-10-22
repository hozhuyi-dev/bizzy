// Command migrate brings the table to the schema this code reads: it runs
// the migrations the table hasn't had (see platform/migrate and
// internal/migrations). Deploys invoke the deployed Lambda right after
// updating the functions, which refuse the table until it has run
// (scripts/migrate.mjs).
//
// Run here, it is a dry run of this checkout's migrations against a real
// table: what a deploy would do, on a copy in memory.
//
//	TABLE_NAME=… TIME_ZONE=… go run ./cmd/migrate -dry-run
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"time"
	_ "time/tzdata"

	"github.com/aws/aws-lambda-go/lambda"

	"bizzy-lambda/internal/app"
	"bizzy-lambda/internal/migrations"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/migrate"
	"bizzy-lambda/internal/platform/txn"
)

// request is what the Lambda is invoked with.
type request struct {
	DryRun bool `json:"dryRun"`
}

func main() {
	ctx := context.Background()
	tb, err := dynamo.New(ctx)
	if err != nil {
		log.Fatal(err)
	}
	loc, err := time.LoadLocation(os.Getenv("TIME_ZONE"))
	if err != nil {
		log.Fatalf("TIME_ZONE: %v", err)
	}
	o := migrate.Options{
		Runner: &txn.Runner{
			Table: tb, Invariants: app.Invariants(), Location: loc, Now: time.Now,
			NewID: func() string { return "" }, Schema: migrations.Version,
		},
		Kinds:      app.Kinds(),
		Migrations: migrations.All,
	}
	// Production's table, which keeps business records, is backed up
	// before each migration.
	if os.Getenv("BACKUP") == "true" {
		o.Backup = tb.Backup
	}

	if os.Getenv("AWS_LAMBDA_RUNTIME_API") != "" {
		lambda.Start(func(ctx context.Context, in request) (migrate.Report, error) { return run(ctx, o, in.DryRun) })
		return
	}
	dryRun := flag.Bool("dry-run", false, "migrate a copy of the table in memory, writing nothing")
	flag.Parse()
	rep, err := run(ctx, o, *dryRun)
	out, _ := json.MarshalIndent(rep, "", "  ")
	log.Printf("%s", out)
	if err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context, o migrate.Options, dryRun bool) (migrate.Report, error) {
	if dryRun {
		return migrate.DryRun(ctx, o)
	}
	return migrate.Run(ctx, o)
}

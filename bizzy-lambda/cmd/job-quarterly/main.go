// Command job-quarterly is the Lambda EventBridge runs every quarter: the
// upkeep rare enough not to need doing more often. Each task is
// independent; one failing doesn't stop the rest, and the run fails if any
// did. A job on another schedule is its own command (job-<interval>).
//
// Tasks:
//   - sweep: deletes the attachment files no attachment links to, which a
//     request that died between writing an item and deleting its file
//     left behind (see attachments.Sweep).
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/txn"
)

// task is one piece of upkeep.
type task struct {
	name string
	run  func(ctx context.Context) error
}

// grace leaves alone files written in the last week: an upload still
// under way, or one its confirm is about to link.
const grace = 7 * 24 * time.Hour

func main() {
	ctx := context.Background()
	tb, err := dynamo.New(ctx)
	if err != nil {
		log.Fatal(err)
	}
	bucket := os.Getenv("BUCKET_NAME")
	if bucket == "" {
		log.Fatal("BUCKET_NAME is not set")
	}
	blobs, err := blobstore.NewS3(ctx, bucket)
	if err != nil {
		log.Fatal(err)
	}
	run := &txn.Runner{Table: tb, Location: time.UTC, Now: time.Now, NewID: func() string { return "" }}

	tasks := []task{
		{name: "sweep", run: func(ctx context.Context) error {
			deleted, err := attachments.Sweep(ctx, run, blobs, time.Now().Add(-grace))
			if err == nil {
				slog.InfoContext(ctx, "swept attachment files no attachment links to", "deleted", deleted)
			}
			return err
		}},
	}

	lambda.Start(func(ctx context.Context) error {
		var failed []error
		for _, t := range tasks {
			if err := t.run(ctx); err != nil {
				slog.ErrorContext(ctx, "task failed", "task", t.name, "error", err)
				failed = append(failed, fmt.Errorf("%s: %w", t.name, err))
			}
		}
		return errors.Join(failed...)
	})
}

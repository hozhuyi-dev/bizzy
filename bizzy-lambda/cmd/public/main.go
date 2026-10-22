// Command public serves share links: GET <function URL>/<token> returns
// the issued document the token opens and its PDF, for whoever has the
// link (see documents/share.go). It is the only thing reachable without
// signing in, so it is its own function, which can read single items and
// issued PDFs, and nothing else (see bizzy-infra api-stack).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/migrations"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

func main() {
	tb, err := dynamo.New(context.Background())
	if err != nil {
		log.Fatal(err)
	}
	blobs, err := blobstore.NewS3(context.Background(), os.Getenv("BUCKET_NAME"))
	if err != nil {
		log.Fatal(err)
	}
	run := &txn.Runner{Table: tb, Location: time.UTC, Now: time.Now, NewID: func() string { return "" }, Schema: migrations.Version}
	lambda.Start(func(ctx context.Context, req events.LambdaFunctionURLRequest) (events.LambdaFunctionURLResponse, error) {
		return serve(ctx, run, blobs, req)
	})
}

// serve answers in the API's {data} / {error} shape, so the app reads both
// the same way.
func serve(ctx context.Context, run *txn.Runner, blobs blobstore.Store, req events.LambdaFunctionURLRequest) (events.LambdaFunctionURLResponse, error) {
	if req.RequestContext.HTTP.Method != http.MethodGet {
		return respond(http.StatusMethodNotAllowed, router.Response{Error: &router.ErrorBody{Code: apperr.CodeInvalid, Message: "GET only"}})
	}
	token := strings.Trim(req.RawPath, "/")
	// Every transaction reads the table a few times, and this function is
	// open to anyone; a guess of the wrong shape costs none of its capacity.
	if !documents.IsShareToken(token) {
		return respond(http.StatusNotFound, router.Response{Error: &router.ErrorBody{Code: apperr.CodeNotFound, Message: documents.Shares.Gone}})
	}
	type opened struct {
		doc *documents.Document
		rev *documents.Revision
	}
	found, err := txn.Read(ctx, run, func(tx *txn.Tx) (opened, error) {
		d, err := documents.Open(tx, token)
		if err != nil {
			return opened{}, err
		}
		r, err := documents.IssuedRevision(tx, d)
		return opened{d, r}, err
	})
	var shared documents.SharedView
	if err == nil {
		// Read only: a PDF the issue didn't store is printed, not stored.
		var pdf documents.File
		pdf, err = documents.ServedPDF(ctx, blobs, found.doc, found.rev, false)
		shared = documents.SharedViewOf(found.doc, pdf)
	}
	if err != nil {
		var shown *apperr.Error
		if errors.As(err, &shown) {
			return respond(http.StatusNotFound, router.Response{Error: &router.ErrorBody{Code: shown.Code, Message: shown.Message}})
		}
		slog.ErrorContext(ctx, "open shared document", "error", err)
		return respond(http.StatusInternalServerError, router.Response{Error: &router.ErrorBody{Code: "internal", Message: "Something went wrong."}})
	}
	return respond(http.StatusOK, router.Response{Data: shared})
}

func respond(status int, body router.Response) (events.LambdaFunctionURLResponse, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return events.LambdaFunctionURLResponse{}, err
	}
	return events.LambdaFunctionURLResponse{
		StatusCode: status,
		Headers: map[string]string{
			"Content-Type": "application/json",
			// A reset must take effect at once, and the content is personal.
			"Cache-Control": "no-store",
			"X-Robots-Tag":  "noindex",
		},
		Body: string(b),
	}, nil
}

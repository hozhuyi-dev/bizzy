// Command public serves share links: GET <function URL>/<token> returns
// the issued document the token opens, for whoever has the link (see
// documents/share.go). It is the only thing reachable without signing in,
// so it is its own function, which can read single items and nothing else
// (see bizzy-infra api-stack).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

func main() {
	tb, err := dynamo.New(context.Background())
	if err != nil {
		log.Fatal(err)
	}
	run := &txn.Runner{Table: tb, Location: time.UTC, Now: time.Now, NewID: func() string { return "" }}
	lambda.Start(func(ctx context.Context, req events.LambdaFunctionURLRequest) (events.LambdaFunctionURLResponse, error) {
		return serve(ctx, run, req)
	})
}

// serve answers in the API's {data} / {error} shape, so the app reads both
// the same way.
func serve(ctx context.Context, run *txn.Runner, req events.LambdaFunctionURLRequest) (events.LambdaFunctionURLResponse, error) {
	if req.RequestContext.HTTP.Method != http.MethodGet {
		return respond(http.StatusMethodNotAllowed, router.Response{Error: &router.ErrorBody{Code: apperr.CodeInvalid, Message: "GET only"}})
	}
	token := strings.Trim(req.RawPath, "/")
	shared, err := txn.Read(ctx, run, func(tx *txn.Tx) (documents.SharedView, error) {
		d, err := documents.Open(tx, token)
		if err != nil {
			return documents.SharedView{}, err
		}
		return documents.SharedViewOf(d), nil
	})
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

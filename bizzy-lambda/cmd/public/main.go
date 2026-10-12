// Command public serves share links: GET <function URL>/<token> returns the
// issued document the token opens, for whoever has the link. It is the only
// thing reachable without signing in, so it is its own function that can
// read items and nothing else (see bizzy-infra api-stack).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"log/slog"
	"net/http"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

func main() {
	store, err := dynamo.New(context.Background())
	if err != nil {
		log.Fatal(err)
	}
	lambda.Start(handler{repo: documents.NewRepository(store)}.serve)
}

type handler struct {
	repo documents.SharedStore
}

// serve answers in the API's {data} / {error} shape, so the app reads both
// the same way.
func (h handler) serve(ctx context.Context, req events.LambdaFunctionURLRequest) (events.LambdaFunctionURLResponse, error) {
	if req.RequestContext.HTTP.Method != http.MethodGet {
		return respond(http.StatusMethodNotAllowed, router.Response{Error: &router.ErrorBody{Code: apperr.CodeInvalid, Message: "GET only"}})
	}
	token := strings.Trim(req.RawPath, "/")
	shared, err := documents.ReadShared(ctx, h.repo, token)
	if err != nil {
		var appErr *apperr.Error
		if errors.As(err, &appErr) {
			return respond(http.StatusNotFound, router.Response{Error: &router.ErrorBody{Code: appErr.Code, Message: appErr.Message}})
		}
		slog.ErrorContext(ctx, "read shared document", "error", err)
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

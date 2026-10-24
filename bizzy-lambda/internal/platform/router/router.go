// Package router dispatches the web app's direct Lambda invocations.
//
// The app invokes the API with {"action": "clients.list", "payload": ...}
// and always gets {"data": ...} or {"error": ...} back, with "changed": the
// kinds of item the request changed. Errors the app may show (apperr) are
// returned in the body, not as a Lambda function error, so the app has one
// shape to handle; anything else is logged and reported as internal.
package router

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"maps"
	"slices"
	"time"

	"bizzy-lambda/internal/platform/apperr"
)

type Request struct {
	Action  string          `json:"action"`
	Payload json.RawMessage `json:"payload"`
}

type Response struct {
	Data  any        `json:"data,omitempty"`
	Error *ErrorBody `json:"error,omitempty"`
	// Changed are the kinds of item the request changed, whether or not it
	// then failed: the app reads again only what shows them.
	Changed []string `json:"changed,omitempty"`
	// Versions are the partitions' versions as the request last saw them
	// (in decimal), so the app also reads again what others changed: a
	// kind whose version isn't the one it last saw.
	Versions map[string]string `json:"versions,omitempty"`
}

type ErrorBody struct {
	Code     apperr.Code     `json:"code"`
	Message  string          `json:"message"`
	Remedies []apperr.Remedy `json:"remedies,omitempty"`
}

type Handler func(ctx context.Context, payload json.RawMessage) (any, error)

// Kind says whether an action only reads or also changes something. The
// simulation drives every mutation (see internal/simulation).
type Kind string

const (
	Query    Kind = "query"
	Mutation Kind = "mutation"
)

type Router struct {
	handlers map[string]Handler
	kinds    map[string]Kind
	// Scope, when set, wraps every request: it gives the request its
	// context, and a function that finishes the request, once its handler
	// returns, and says what it changed, the versions it saw and what it
	// counted (see txn.Scope).
	Scope func(ctx context.Context) (context.Context, func(ctx context.Context) ([]string, map[string]string, map[string]int))
	// LogRequests logs a line per request (see logRequest): the Lambda's,
	// not the tests' thousands.
	LogRequests bool
}

func New() *Router {
	return &Router{handlers: map[string]Handler{}, kinds: map[string]Kind{}}
}

// Query registers an action that only reads.
func (r *Router) Query(action string, h Handler) { r.register(action, Query, h) }

// Mutation registers an action that changes something.
func (r *Router) Mutation(action string, h Handler) { r.register(action, Mutation, h) }

func (r *Router) register(action string, kind Kind, h Handler) {
	if _, exists := r.handlers[action]; exists {
		panic("router: duplicate action " + action)
	}
	r.handlers[action], r.kinds[action] = h, kind
}

// Actions lists the registered actions of a kind, sorted.
func (r *Router) Actions(kind Kind) []string {
	var out []string
	for action, k := range r.kinds {
		if k == kind {
			out = append(out, action)
		}
	}
	slices.Sort(out)
	return out
}

// Handle runs one request. Its error is always nil: failures go in the body.
func (r *Router) Handle(ctx context.Context, req Request) (Response, error) {
	h, ok := r.handlers[req.Action]
	if !ok {
		return failed(apperr.Invalid("unknown action %q", req.Action)), nil
	}
	if r.Scope == nil {
		return respond(ctx, req.Action, h, req.Payload), nil
	}
	start := time.Now()
	ctx, end := r.Scope(ctx)
	res := respond(ctx, req.Action, h, req.Payload)
	var counts map[string]int
	res.Changed, res.Versions, counts = end(ctx)
	if r.LogRequests {
		logRequest(ctx, req.Action, time.Since(start), res, counts)
	}
	return res, nil
}

// logRequest is one line per request: what it was, how long it took, how
// it ended, and what it counted (reads of the table, calls to Google), so
// a slow one says why.
func logRequest(ctx context.Context, action string, took time.Duration, res Response, counts map[string]int) {
	attrs := []any{"action", action, "ms", took.Milliseconds()}
	if res.Error != nil {
		attrs = append(attrs, "error", res.Error.Code)
	}
	for _, name := range slices.Sorted(maps.Keys(counts)) {
		attrs = append(attrs, name, counts[name])
	}
	slog.InfoContext(ctx, "request", attrs...)
}

func respond(ctx context.Context, action string, h Handler, payload json.RawMessage) Response {
	data, err := h(ctx, payload)
	var shown *apperr.Error
	switch {
	case errors.As(err, &shown):
		return failed(shown)
	case err != nil:
		slog.ErrorContext(ctx, "action failed", "action", action, "error", err)
		return Response{Error: &ErrorBody{Code: "internal", Message: "Something went wrong."}}
	}
	return Response{Data: data}
}

func failed(err *apperr.Error) Response {
	return Response{Error: &ErrorBody{Code: err.Code, Message: err.Message, Remedies: err.Remedies}}
}

// Typed adapts a handler that takes a decoded payload.
func Typed[In any](fn func(ctx context.Context, in In) (any, error)) Handler {
	return func(ctx context.Context, payload json.RawMessage) (any, error) {
		var in In
		if len(payload) > 0 && string(payload) != "null" {
			if err := json.Unmarshal(payload, &in); err != nil {
				return nil, apperr.Invalid("malformed payload: %v", err)
			}
		}
		return fn(ctx, in)
	}
}

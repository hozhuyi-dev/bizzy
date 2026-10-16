// Package router dispatches the web app's direct Lambda invocations.
//
// The app invokes the API with {"action": "clients.list", "payload": ...}
// and always gets {"data": ...} or {"error": ...} back. Errors the app may
// show (apperr) are returned in the body, not as a Lambda function error, so
// the app has one shape to handle; anything else is logged and reported as
// internal.
package router

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"slices"

	"bizzy-lambda/internal/platform/apperr"
)

type Request struct {
	Action  string          `json:"action"`
	Payload json.RawMessage `json:"payload"`
}

type Response struct {
	Data  any        `json:"data,omitempty"`
	Error *ErrorBody `json:"error,omitempty"`
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
	data, err := h(ctx, req.Payload)
	var shown *apperr.Error
	switch {
	case errors.As(err, &shown):
		return failed(shown), nil
	case err != nil:
		slog.ErrorContext(ctx, "action failed", "action", req.Action, "error", err)
		return Response{Error: &ErrorBody{Code: "internal", Message: "Something went wrong."}}, nil
	}
	return Response{Data: data}, nil
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

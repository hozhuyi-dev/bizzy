// Package router dispatches direct Lambda invocations from the web app.
//
// The app invokes the function with {"action": "clients.list", "payload": ...}
// and always gets {"data": ...} or {"error": ...} back. Application errors are
// returned in the body rather than as a Lambda function error, so the client
// has one shape to handle.
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
	Code    apperr.Code `json:"code"`
	Message string      `json:"message"`
}

type Handler func(ctx context.Context, payload json.RawMessage) (any, error)

// Kind says whether an action only reads or also changes state. Every
// mutation must be covered by the simulation (see internal/simulation),
// which drives the router exactly as the app does.
type Kind string

const (
	KindQuery    Kind = "query"
	KindMutation Kind = "mutation"
)

type Router struct {
	handlers map[string]Handler
	kinds    map[string]Kind
}

func New() *Router {
	return &Router{handlers: make(map[string]Handler), kinds: make(map[string]Kind)}
}

// Query registers an action that only reads.
func (r *Router) Query(action string, handler Handler) {
	r.register(action, KindQuery, handler)
}

// Mutation registers an action that changes state.
func (r *Router) Mutation(action string, handler Handler) {
	r.register(action, KindMutation, handler)
}

func (r *Router) register(action string, kind Kind, handler Handler) {
	if _, exists := r.handlers[action]; exists {
		panic("router: duplicate action " + action)
	}
	r.handlers[action] = handler
	r.kinds[action] = kind
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

func (r *Router) Handle(ctx context.Context, req Request) (Response, error) {
	handler, ok := r.handlers[req.Action]
	if !ok {
		return errorResponse(apperr.Invalid("unknown action %q", req.Action)), nil
	}

	data, err := handler(ctx, req.Payload)
	if err != nil {
		var appErr *apperr.Error
		if errors.As(err, &appErr) {
			return errorResponse(appErr), nil
		}
		slog.ErrorContext(ctx, "action failed", "action", req.Action, "error", err)
		return Response{Error: &ErrorBody{Code: "internal", Message: "Something went wrong."}}, nil
	}

	return Response{Data: data}, nil
}

// Typed adapts a handler that takes a decoded payload.
func Typed[In any](fn func(ctx context.Context, in In) (any, error)) Handler {
	return func(ctx context.Context, payload json.RawMessage) (any, error) {
		var in In
		if len(payload) > 0 {
			if err := json.Unmarshal(payload, &in); err != nil {
				return nil, apperr.Invalid("malformed payload: %v", err)
			}
		}
		return fn(ctx, in)
	}
}

func errorResponse(err *apperr.Error) Response {
	return Response{Error: &ErrorBody{Code: err.Code, Message: err.Message}}
}

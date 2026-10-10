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

type Router struct {
	handlers map[string]Handler
}

func New() *Router {
	return &Router{handlers: make(map[string]Handler)}
}

func (r *Router) Register(action string, handler Handler) {
	if _, exists := r.handlers[action]; exists {
		panic("router: duplicate action " + action)
	}
	r.handlers[action] = handler
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

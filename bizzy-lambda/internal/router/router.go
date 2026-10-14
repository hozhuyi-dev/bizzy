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
	// Guard and Remedies are set when a guard refused the action: the app
	// offers each remedy as a button.
	Guard    string          `json:"guard,omitempty"`
	Remedies []apperr.Remedy `json:"remedies,omitempty"`
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
	// Journal, when set, notes each mutation before it runs and drops the
	// note once it finished or was refused (see internal/features/recovery).
	Journal Journal
}

// Journal notes the mutations running, so that one that died partway is
// found and repaired.
type Journal interface {
	Begin(ctx context.Context, action string) (string, error)
	End(ctx context.Context, id string) error
}

type entryKey struct{}

// EntryOf is the journal entry of the mutation ctx belongs to; "" when none.
func EntryOf(ctx context.Context) string {
	id, _ := ctx.Value(entryKey{}).(string)
	return id
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

	entry := ""
	if r.Journal != nil && r.kinds[req.Action] == KindMutation {
		id, err := r.Journal.Begin(ctx, req.Action)
		if err != nil {
			slog.ErrorContext(ctx, "journal", "action", req.Action, "error", err)
			return internalError, nil
		}
		entry, ctx = id, context.WithValue(ctx, entryKey{}, id)
	}

	data, err := handler(ctx, req.Payload)
	var appErr *apperr.Error
	refused := errors.As(err, &appErr)
	// A failure leaves its entry: what it wrote before failing is repaired
	// with the next sync, as after a crash.
	if entry != "" && (err == nil || refused) {
		if err := r.Journal.End(ctx, entry); err != nil {
			slog.ErrorContext(ctx, "journal", "action", req.Action, "error", err)
		}
	}
	switch {
	case refused:
		return errorResponse(appErr), nil
	case err != nil:
		slog.ErrorContext(ctx, "action failed", "action", req.Action, "error", err)
		return internalError, nil
	}
	return Response{Data: data}, nil
}

var internalError = Response{Error: &ErrorBody{Code: "internal", Message: "Something went wrong."}}

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
	return Response{Error: &ErrorBody{Code: err.Code, Message: err.Message, Guard: err.Guard, Remedies: err.Remedies}}
}

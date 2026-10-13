package router

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"bizzy-lambda/internal/platform/apperr"
)

type echoIn struct {
	Name string `json:"name"`
}

func newTestRouter() *Router {
	r := New()
	r.Query("echo", Typed(func(_ context.Context, in echoIn) (any, error) {
		if in.Name == "" {
			return nil, apperr.Invalid("name is required")
		}
		return in.Name, nil
	}))
	r.Mutation("boom", func(context.Context, json.RawMessage) (any, error) {
		return nil, errors.New("dynamo exploded")
	})
	return r
}

func TestHandle(t *testing.T) {
	r := newTestRouter()
	ctx := context.Background()

	tests := []struct {
		name     string
		req      Request
		wantData any
		wantCode apperr.Code
	}{
		{name: "success", req: Request{Action: "echo", Payload: json.RawMessage(`{"name":"jane"}`)}, wantData: "jane"},
		{name: "app error", req: Request{Action: "echo", Payload: json.RawMessage(`{}`)}, wantCode: apperr.CodeInvalid},
		{name: "malformed payload", req: Request{Action: "echo", Payload: json.RawMessage(`[`)}, wantCode: apperr.CodeInvalid},
		{name: "unknown action", req: Request{Action: "nope"}, wantCode: apperr.CodeInvalid},
		{name: "internal error is hidden", req: Request{Action: "boom"}, wantCode: "internal"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := r.Handle(ctx, tt.req)
			if err != nil {
				t.Fatalf("Handle returned error: %v", err)
			}
			if tt.wantCode != "" {
				if res.Error == nil || res.Error.Code != tt.wantCode {
					t.Fatalf("error = %+v, want code %q", res.Error, tt.wantCode)
				}
				return
			}
			if res.Error != nil || res.Data != tt.wantData {
				t.Fatalf("response = %+v, want data %v", res, tt.wantData)
			}
		})
	}
}

func TestActionsByKind(t *testing.T) {
	r := newTestRouter()
	if got := r.Actions(KindQuery); len(got) != 1 || got[0] != "echo" {
		t.Errorf("queries = %v, want [echo]", got)
	}
	if got := r.Actions(KindMutation); len(got) != 1 || got[0] != "boom" {
		t.Errorf("mutations = %v, want [boom]", got)
	}
}

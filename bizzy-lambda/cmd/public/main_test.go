package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aws/aws-lambda-go/events"

	"bizzy-lambda/internal/features/documents"
)

const token = "abcdefghijklmnopqrstuv"

type fakeStore struct{ err error }

func (f fakeStore) SharedID(_ context.Context, t string) (string, bool, error) {
	return "d1", t == token, f.err
}

func (f fakeStore) Get(_ context.Context, id string) (documents.Document, bool, error) {
	return documents.Document{
		ID: id, Type: documents.TypeReceipt, Status: documents.StatusIssued, Number: "RCP-0001",
		ShareToken: token,
		Content:    &documents.Content{Recipient: documents.Recipient{Name: "Jane"}},
		// A revision in progress is never shown.
		Draft: &documents.Content{Recipient: documents.Recipient{Name: "Draft"}},
	}, true, nil
}

func get(path string) events.LambdaFunctionURLRequest {
	req := events.LambdaFunctionURLRequest{RawPath: path}
	req.RequestContext.HTTP.Method = "GET"
	return req
}

func TestServe(t *testing.T) {
	h := handler{repo: fakeStore{}}

	res, err := h.serve(context.Background(), get("/"+token))
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 200 || !strings.Contains(res.Body, `"name":"Jane"`) || strings.Contains(res.Body, "Draft") {
		t.Errorf("ok response = %d %s", res.StatusCode, res.Body)
	}
	if res.Headers["Cache-Control"] != "no-store" {
		t.Error("shared documents must not be cached")
	}

	res, _ = h.serve(context.Background(), get("/zzzzzzzzzzzzzzzzzzzzzz"))
	if res.StatusCode != 404 || !strings.Contains(res.Body, `"not_found"`) {
		t.Errorf("unknown token = %d %s", res.StatusCode, res.Body)
	}

	post := get("/" + token)
	post.RequestContext.HTTP.Method = "POST"
	if res, _ = h.serve(context.Background(), post); res.StatusCode != 405 {
		t.Errorf("POST = %d, want 405", res.StatusCode)
	}

	res, _ = handler{repo: fakeStore{err: errors.New("boom")}}.serve(context.Background(), get("/"+token))
	if res.StatusCode != 500 || strings.Contains(res.Body, "boom") {
		t.Errorf("failure = %d %s, want a generic 500", res.StatusCode, res.Body)
	}
}

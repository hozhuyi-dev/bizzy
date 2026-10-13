package documents

import (
	"context"
	"regexp"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/router"
)

type handler struct{ Service }

func Register(r *router.Router, deps Deps) {
	h := handler{Service{deps}}
	r.Query("documents.list", router.Typed(h.list))
	r.Query("documents.listByClient", router.Typed(h.listByClient))
	r.Query("documents.get", router.Typed(h.get))
	r.Mutation("documents.createDraft", router.Typed(h.createDraft))
	r.Mutation("documents.saveDraft", router.Typed(h.saveDraft))
	r.Mutation("documents.issue", router.Typed(h.issue))
	r.Mutation("documents.revise", router.Typed(h.revise))
	r.Mutation("documents.discardDraft", router.Typed(h.discardDraft))
	r.Mutation("documents.cancel", router.Typed(h.cancel))
	r.Mutation("documents.share", router.Typed(h.share))
	r.Mutation("documents.resetShare", router.Typed(h.resetShare))
}

// out turns a service result into a handler's.
func out[T any](v T, err error) (any, error) {
	if err != nil {
		return nil, err
	}
	return v, nil
}

type listInput struct {
	Type Type `json:"type"`
	// Month is "2026-10": a list covers one month of document dates, so it
	// stays small however many years of documents there are.
	Month string `json:"month"`
}

var monthPattern = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)

func (h handler) list(ctx context.Context, in listInput) (any, error) {
	if !monthPattern.MatchString(in.Month) {
		return nil, apperr.Invalid("choose a month like 2026-10")
	}
	return out(h.List(ctx, in.Type, in.Month))
}

type clientInput struct {
	ClientID string `json:"clientId"`
}

func (h handler) listByClient(ctx context.Context, in clientInput) (any, error) {
	if in.ClientID == "" {
		return nil, apperr.Invalid("choose a client")
	}
	return out(h.ListByClient(ctx, in.ClientID))
}

type idInput struct {
	ID string `json:"id"`
	// Version is the one she was looking at, so a stale tab can't overwrite.
	Version int `json:"version"`
}

type getOutput struct {
	Document  Document   `json:"document"`
	Revisions []Revision `json:"revisions"`
}

func (h handler) get(ctx context.Context, in idInput) (any, error) {
	doc, revisions, err := h.Get(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	return getOutput{Document: doc, Revisions: revisions}, nil
}

type createDraftInput struct {
	Type    Type     `json:"type"`
	Sources []Source `json:"sources"`
}

func (h handler) createDraft(ctx context.Context, in createDraftInput) (any, error) {
	return out(h.CreateDraft(ctx, in.Type, in.Sources))
}

type saveDraftInput struct {
	ID      string  `json:"id"`
	Version int     `json:"version"`
	Content Content `json:"content"`
}

func (h handler) saveDraft(ctx context.Context, in saveDraftInput) (any, error) {
	return out(h.SaveDraft(ctx, in.ID, in.Version, in.Content))
}

func (h handler) issue(ctx context.Context, in idInput) (any, error) {
	return out(h.Issue(ctx, in.ID, in.Version))
}

func (h handler) revise(ctx context.Context, in idInput) (any, error) {
	return out(h.Revise(ctx, in.ID, in.Version))
}

// discardDraft returns null when the draft was never issued and is gone.
func (h handler) discardDraft(ctx context.Context, in idInput) (any, error) {
	doc, err := h.DiscardDraft(ctx, in.ID, in.Version)
	if err != nil || doc == nil {
		return nil, err
	}
	return *doc, nil
}

type cancelInput struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
	Reason  string `json:"reason"`
}

func (h handler) cancel(ctx context.Context, in cancelInput) (any, error) {
	return out(h.Cancel(ctx, in.ID, in.Version, in.Reason))
}

type shareInput struct {
	IDs []string `json:"ids"`
}

func (h handler) share(ctx context.Context, in shareInput) (any, error) {
	if len(in.IDs) == 0 {
		return nil, apperr.Invalid("choose what to share")
	}
	return out(h.Share(ctx, in.IDs))
}

func (h handler) resetShare(ctx context.Context, in idInput) (any, error) {
	return out(h.ResetShare(ctx, in.ID, in.Version))
}

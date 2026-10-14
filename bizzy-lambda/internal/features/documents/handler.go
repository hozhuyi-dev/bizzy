package documents

import (
	"context"
	"errors"
	"regexp"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

// Store is what the documents feature reads and writes itself: everything
// else a document goes through is the book's (see internal/features/book).
type Store interface {
	Get(ctx context.Context, id string) (Document, bool, error)
	ListByMonth(ctx context.Context, docType Type, month string) ([]Document, error)
	ListByClient(ctx context.Context, clientID string) ([]Document, error)
	SharedID(ctx context.Context, token string) (string, bool, error)
	Revisions(ctx context.Context, id string) ([]Revision, error)
	SetShare(ctx context.Context, d Document, change ShareChange) error
}

type Deps struct {
	Repo    Store
	Clients interface {
		Get(ctx context.Context, id string) (clients.Client, bool, error)
	}
	Settings interface {
		Get(ctx context.Context) (settings.Settings, error)
	}
}

// Service reads documents, and keeps their share links.
type Service struct{ Deps }

// Register serves documents to the app. Drafting, issuing, revising and
// cancelling one are the book's commands.
func Register(r *router.Router, deps Deps) {
	h := handler{Service{deps}}
	r.Query("documents.list", router.Typed(h.list))
	r.Query("documents.listByClient", router.Typed(h.listByClient))
	r.Query("documents.get", router.Typed(h.get))
	r.Mutation("documents.share", router.Typed(h.share))
	r.Mutation("documents.resetShare", router.Typed(h.resetShare))
}

type handler struct{ Service }

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
	if _, ok := Types[in.Type]; !ok {
		return nil, apperr.Invalid("unknown document type %q", in.Type)
	}
	docs, err := h.Repo.ListByMonth(ctx, in.Type, in.Month)
	return out(summaries(docs), err)
}

type clientInput struct {
	ClientID string `json:"clientId"`
}

// listByClient returns a client's documents of every type, newest first,
// with the drafts not issued yet at the end.
func (h handler) listByClient(ctx context.Context, in clientInput) (any, error) {
	if in.ClientID == "" {
		return nil, apperr.Invalid("choose a client")
	}
	docs, err := h.Repo.ListByClient(ctx, in.ClientID)
	return out(summaries(docs), err)
}

func summaries(docs []Document) []Summary {
	out := make([]Summary, len(docs))
	for i, d := range docs {
		out[i] = d.Summary()
	}
	return out
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

// get returns a document and its issued revisions; a draft as it would be
// issued now (see Fill).
func (h handler) get(ctx context.Context, in idInput) (any, error) {
	doc, err := h.load(ctx, in.ID, 0)
	if err != nil {
		return nil, err
	}
	if doc.Draft != nil && doc.Number == "" {
		cfg, err := h.Settings.Get(ctx)
		if err != nil {
			return nil, err
		}
		client, _, err := h.Clients.Get(ctx, doc.ClientID)
		if err != nil {
			return nil, err
		}
		filled := Fill(*doc.Draft, cfg, client)
		doc.Draft = &filled
	}
	revisions, err := h.Repo.Revisions(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	return getOutput{Document: doc, Revisions: revisions}, nil
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

// load reads a document. A version other than 0 is the one she was looking
// at, so a stale tab can't overwrite.
func (svc Service) load(ctx context.Context, id string, version int) (Document, error) {
	doc, found, err := svc.Repo.Get(ctx, id)
	if err != nil {
		return doc, err
	}
	if !found {
		return doc, apperr.NotFound("document not found")
	}
	if version != 0 && doc.Version != version {
		return doc, apperr.Conflict("this document changed elsewhere; reload it")
	}
	return doc, nil
}

func conflictErr(err error) error {
	if errors.Is(err, dynamo.ErrTransactionConflict) {
		return apperr.Conflict("something changed while saving; reload and try again")
	}
	return err
}

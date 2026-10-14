package followups

import (
	"context"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

// HandlerStore is what the handlers read and write.
type HandlerStore interface {
	Get(ctx context.Context, id string) (FollowUp, bool, error)
	ListBySession(ctx context.Context, sessionID string) ([]FollowUp, error)
	PageOpen(ctx context.Context, cursor string, limit int) (dynamo.Page[FollowUp], error)
	PageDone(ctx context.Context, cursor string, limit int) (dynamo.Page[FollowUp], error)
	PageByClient(ctx context.Context, clientID, cursor string, limit int) (dynamo.Page[FollowUp], error)
}

type handler struct {
	repo HandlerStore
}

// Register serves follow-ups to the app. Making, changing, marking done and
// deleting one are the book's (see internal/features/book).
func Register(r *router.Router, repo HandlerStore) {
	h := handler{repo: repo}
	r.Query("followUps.list", router.Typed(h.list))
	r.Query("followUps.listByClient", router.Typed(h.listByClient))
	r.Query("followUps.listBySession", router.Typed(h.listBySession))
}

// PageSize is how many follow-ups a list loads at a time.
const PageSize = 30

type View string

const (
	ViewUpcoming View = "upcoming"
	ViewDone     View = "done"
)

type listInput struct {
	View   View   `json:"view"`
	Cursor string `json:"cursor"`
}

// list returns a page of follow-ups not done (soonest first) or done
// (latest first).
func (h handler) list(ctx context.Context, in listInput) (any, error) {
	switch in.View {
	case ViewUpcoming:
		return h.repo.PageOpen(ctx, in.Cursor, PageSize)
	case ViewDone:
		return h.repo.PageDone(ctx, in.Cursor, PageSize)
	default:
		return nil, apperr.Invalid("unknown view %q", in.View)
	}
}

type listByClientInput struct {
	ClientID string `json:"clientId"`
	Cursor   string `json:"cursor"`
}

func (h handler) listByClient(ctx context.Context, in listByClientInput) (any, error) {
	if in.ClientID == "" {
		return nil, apperr.Invalid("choose a client")
	}
	return h.repo.PageByClient(ctx, in.ClientID, in.Cursor, PageSize)
}

type listBySessionInput struct {
	SessionID string `json:"sessionId"`
}

func (h handler) listBySession(ctx context.Context, in listBySessionInput) (any, error) {
	if in.SessionID == "" {
		return nil, apperr.Invalid("choose a session")
	}
	return h.repo.ListBySession(ctx, in.SessionID)
}

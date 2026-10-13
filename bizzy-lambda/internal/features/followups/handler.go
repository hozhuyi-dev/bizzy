package followups

import (
	"context"
	"errors"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

// HandlerStore is what the handlers read and write.
type HandlerStore interface {
	Get(ctx context.Context, eventID string) (FollowUp, bool, error)
	ListBySession(ctx context.Context, sessionID string) ([]FollowUp, error)
	PageOpen(ctx context.Context, cursor string, limit int) (dynamo.Page[FollowUp], error)
	PageDone(ctx context.Context, cursor string, limit int) (dynamo.Page[FollowUp], error)
	PageByClient(ctx context.Context, clientID, cursor string, limit int) (dynamo.Page[FollowUp], error)
	Save(ctx context.Context, f FollowUp) (FollowUp, error)
}

type handler struct {
	repo HandlerStore
	now  func() time.Time
}

// Register serves follow-ups to the app. Making, editing and deleting one
// goes through the calendar; see googlesync.RegisterFollowUpEditor.
func Register(r *router.Router, repo HandlerStore, now func() time.Time) {
	h := handler{repo: repo, now: now}
	r.Query("followUps.list", router.Typed(h.list))
	r.Query("followUps.listByClient", router.Typed(h.listByClient))
	r.Query("followUps.listBySession", router.Typed(h.listBySession))
	r.Mutation("followUps.setDone", router.Typed(h.setDone))
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

type setDoneInput struct {
	EventID string `json:"eventId"`
	Done    bool   `json:"done"`
}

// ErrGone is a follow-up no longer stored.
var ErrGone = apperr.NotFound("This follow-up is no longer in the calendar.")

// setDone marks a follow-up done, or not done again.
func (h handler) setDone(ctx context.Context, in setDoneInput) (any, error) {
	for attempt := 0; ; attempt++ {
		f, found, err := h.repo.Get(ctx, in.EventID)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, ErrGone
		}
		if (f.DoneAt != nil) == in.Done {
			return f, nil
		}
		f.DoneAt = nil
		if in.Done {
			now := h.now().UTC()
			f.DoneAt = &now
		}
		saved, err := h.repo.Save(ctx, f)
		if errors.Is(err, dynamo.ErrConflict) && attempt < 3 {
			continue
		}
		return saved, err
	}
}

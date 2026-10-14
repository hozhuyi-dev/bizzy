package conflicts

import (
	"context"
	"encoding/json"

	"bizzy-lambda/internal/router"
)

// HandlerStore is what the handlers read.
type HandlerStore interface {
	ListOpen(ctx context.Context) ([]Conflict, error)
	ListByTarget(ctx context.Context, targetID string) ([]Conflict, error)
}

type handler struct{ repo HandlerStore }

// Register serves the conflicts to the app. Settling one goes through the
// surface it came from (see googlesync), or a remedy's own action.
func Register(r *router.Router, repo HandlerStore) {
	h := handler{repo: repo}
	r.Query("conflicts.list", h.list)
	r.Query("conflicts.listByTarget", router.Typed(h.listByTarget))
}

func (h handler) list(ctx context.Context, _ json.RawMessage) (any, error) {
	all, err := h.repo.ListOpen(ctx)
	return Views(all), err
}

type targetInput struct {
	TargetID string `json:"targetId"`
}

func (h handler) listByTarget(ctx context.Context, in targetInput) (any, error) {
	all, err := h.repo.ListByTarget(ctx, in.TargetID)
	return Views(all), err
}

package packages

import (
	"context"
	"time"

	"bizzy-lambda/internal/router"
)

// HandlerStore is what the handlers read.
type HandlerStore interface {
	List(ctx context.Context) ([]Package, error)
	ListOpen(ctx context.Context) ([]Package, error)
}

type handler struct {
	repo  HandlerStore
	judge Judge
	now   func() time.Time
}

// Register serves packages to the app. Buying, changing and deleting one
// are the book's commands (see internal/features/book); judge is the book's
// verdict on them, for the views.
func Register(r *router.Router, repo HandlerStore, judge Judge, now func() time.Time) {
	h := handler{repo: repo, judge: judge, now: now}
	r.Query("packages.list", router.Typed(h.list))
}

type listInput struct {
	// All includes used-up packages; by default only open ones are listed.
	All bool `json:"all"`
}

func (h handler) list(ctx context.Context, in listInput) (any, error) {
	list := h.repo.ListOpen
	if in.All {
		list = h.repo.List
	}
	all, err := list(ctx)
	if err != nil {
		return nil, err
	}
	return Views(ctx, all, h.now(), h.judge)
}

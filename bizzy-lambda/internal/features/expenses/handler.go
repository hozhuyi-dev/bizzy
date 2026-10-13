package expenses

import (
	"context"
	"encoding/json"

	"bizzy-lambda/internal/router"
)

type handler struct {
	service Service
}

// Register serves expenses, and the items and categories their lines are
// picked from, to the app.
func Register(r *router.Router, s Service) {
	h := handler{service: s}
	r.Query("expenses.list", router.Typed(h.list))
	r.Query("expenses.get", router.Typed(h.get))
	r.Query("expenses.catalogue", h.catalogue)
	r.Mutation("expenses.save", router.Typed(h.save))
	r.Mutation("expenses.delete", router.Typed(h.delete))
	r.Mutation("expenses.saveItem", router.Typed(h.saveItem))
	r.Mutation("expenses.saveCategories", router.Typed(h.saveCategories))
}

type listInput struct {
	// From and To are days, YYYY-MM-DD, both included.
	From string `json:"from"`
	To   string `json:"to"`
}

func (h handler) list(ctx context.Context, in listInput) (any, error) {
	return h.service.List(ctx, in.From, in.To)
}

type idInput struct {
	ID string `json:"id"`
}

func (h handler) get(ctx context.Context, in idInput) (any, error) {
	return h.service.Get(ctx, in.ID)
}

func (h handler) catalogue(ctx context.Context, _ json.RawMessage) (any, error) {
	return h.service.Catalogue(ctx)
}

func (h handler) save(ctx context.Context, in SaveInput) (any, error) {
	return h.service.Save(ctx, in)
}

type deleteInput struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
}

func (h handler) delete(ctx context.Context, in deleteInput) (any, error) {
	return nil, h.service.Delete(ctx, in.ID, in.Version)
}

func (h handler) saveItem(ctx context.Context, in Item) (any, error) {
	return h.service.SaveItem(ctx, in)
}

type categoriesInput struct {
	Categories []Category `json:"categories"`
}

func (h handler) saveCategories(ctx context.Context, in categoriesInput) (any, error) {
	return h.service.SaveCategories(ctx, in.Categories)
}

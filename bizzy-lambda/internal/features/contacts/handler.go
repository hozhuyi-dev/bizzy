package contacts

import (
	"context"
	"encoding/json"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/router"
)

// Directory is her Google contacts; Google implements it.
type Directory interface {
	List(ctx context.Context) ([]Person, error)
	Get(ctx context.Context, resourceName string) (Person, error)
	Create(ctx context.Context, d Details) (Person, error)
	Update(ctx context.Context, resourceName, etag string, d Details) (Person, error)
	Label(ctx context.Context, resourceName string) error
}

type ClientStore interface {
	List(ctx context.Context) ([]clients.Client, error)
	RefreshContact(ctx context.Context, id string, previous, next clients.Contact) (bool, error)
}

type handler struct {
	dir     Directory
	clients ClientStore
	now     func() time.Time
}

func Register(r *router.Router, dir Directory, clientStore ClientStore, now func() time.Time) {
	h := handler{dir: dir, clients: clientStore, now: now}
	r.Query("contacts.list", h.list)
	r.Query("contacts.get", router.Typed(h.get))
	r.Mutation("contacts.create", router.Typed(h.create))
	r.Mutation("contacts.update", router.Typed(h.update))
}

func (h handler) list(ctx context.Context, _ json.RawMessage) (any, error) {
	return h.dir.List(ctx)
}

type getInput struct {
	ResourceName string `json:"resourceName"`
}

func (h handler) get(ctx context.Context, in getInput) (any, error) {
	if in.ResourceName == "" {
		return nil, apperr.Invalid("resourceName is required")
	}
	return h.dir.Get(ctx, in.ResourceName)
}

func (h handler) create(ctx context.Context, in Details) (any, error) {
	d := in.trimmed()
	if d.GivenName == "" && d.FamilyName == "" {
		return nil, apperr.Invalid("a contact needs a name")
	}
	return h.dir.Create(ctx, d)
}

type updateInput struct {
	ResourceName string  `json:"resourceName"`
	ETag         string  `json:"etag"`
	Details      Details `json:"details"`
}

// update writes her edits to Google, then refreshes the copy on every
// client linked to the contact so lists and receipts show them at once.
func (h handler) update(ctx context.Context, in updateInput) (any, error) {
	if in.ResourceName == "" || in.ETag == "" {
		return nil, apperr.Invalid("resourceName and etag are required")
	}
	person, err := h.dir.Update(ctx, in.ResourceName, in.ETag, in.Details.trimmed())
	if err != nil {
		return nil, err
	}

	all, err := h.clients.List(ctx)
	if err != nil {
		return nil, err
	}
	next := person.Link(h.now())
	for _, c := range all {
		if c.Contact != nil && c.Contact.ResourceName == person.ResourceName {
			if _, err := h.clients.RefreshContact(ctx, c.ID, *c.Contact, next); err != nil {
				return nil, err
			}
		}
	}
	return person, nil
}

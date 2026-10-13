package clients

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

// HandlerStore is what the handlers read and write.
type HandlerStore interface {
	List(ctx context.Context) ([]Client, error)
	Get(ctx context.Context, id string) (Client, bool, error)
	SaveProfile(ctx context.Context, client Client) error
	SetContacted(ctx context.Context, id string, at *time.Time) error
}

// AfterSave runs once a client is saved: new aliases can match unmatched
// sessions, and a new default fee or home-visit setting reprices theirs.
type AfterSave func(ctx context.Context, clientID string) error

// Linker reads a Google contact for a client to link to. The contacts
// feature implements it; it depends on this package, not the other way.
type Linker interface {
	Link(ctx context.Context, resourceName string) (Contact, error)
}

type handler struct {
	repo      HandlerStore
	contacts  Linker
	afterSave AfterSave
	now       func() time.Time
}

func Register(r *router.Router, repo HandlerStore, contacts Linker, afterSave AfterSave, now func() time.Time) {
	h := handler{repo: repo, contacts: contacts, afterSave: afterSave, now: now}
	r.Query("clients.list", h.list)
	r.Mutation("clients.save", router.Typed(h.save))
	r.Mutation("clients.markContacted", router.Typed(h.markContacted))
}

func (h handler) list(ctx context.Context, _ json.RawMessage) (any, error) {
	return h.repo.List(ctx)
}

// save creates a client when ID is empty, otherwise replaces it. Only the
// contact's resource name is read from the input: the details are copied
// from Google when the link is made or changes, and an existing client sent
// without one is unlinked.
func (h handler) save(ctx context.Context, in Client) (any, error) {
	client, err := prepare(in)
	if err != nil {
		return nil, err
	}

	existing, err := h.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	if err := checkAliases(client, existing); err != nil {
		return nil, err
	}

	var current *Client
	if client.ID != "" {
		i := slices.IndexFunc(existing, func(c Client) bool { return c.ID == client.ID })
		if i < 0 {
			return nil, apperr.NotFound("client not found")
		}
		current = &existing[i]
	}

	switch {
	case in.Contact == nil || in.Contact.ResourceName == "":
		// Unlinking undoes a wrong link; a new client starts with one.
		if current == nil {
			return nil, apperr.Invalid("choose the client's Google contact, or create one")
		}
	case current != nil && current.Contact != nil && current.Contact.ResourceName == in.Contact.ResourceName:
		client.Contact = current.Contact
	default:
		contact, err := h.contacts.Link(ctx, in.Contact.ResourceName)
		if err != nil {
			return nil, err
		}
		client.Contact = &contact
	}

	if client.ID == "" {
		client.ID = dynamo.NewID()
	}
	if err := h.repo.SaveProfile(ctx, client); err != nil {
		return nil, err
	}
	if h.afterSave != nil {
		if err := h.afterSave(ctx, client.ID); err != nil {
			return nil, err
		}
	}

	return client, nil
}

type markContactedInput struct {
	ID string `json:"id"`
	// Contacted false clears the mark, to undo a mis-tap.
	Contacted bool `json:"contacted"`
}

// markContacted records a follow-up, which hides the client from the lapsed
// list for a while.
func (h handler) markContacted(ctx context.Context, in markContactedInput) (any, error) {
	if _, found, err := h.repo.Get(ctx, in.ID); err != nil {
		return nil, err
	} else if !found {
		return nil, apperr.NotFound("client not found")
	}

	var at *time.Time
	if in.Contacted {
		now := h.now().UTC()
		at = &now
	}
	return nil, h.repo.SetContacted(ctx, in.ID, at)
}

// prepare validates a client and normalises its aliases, making sure the
// client's own name is one of them.
func prepare(in Client) (Client, error) {
	client := Client{
		ID:              in.ID,
		Name:            strings.Join(strings.Fields(in.Name), " "),
		DefaultFeeCents: in.DefaultFeeCents,
		HomeVisits:      in.HomeVisits,
	}

	if client.Name == "" {
		return client, apperr.Invalid("name is required")
	}
	if client.DefaultFeeCents != nil && *client.DefaultFeeCents < 0 {
		return client, apperr.Invalid("default fee can't be negative")
	}

	aliases := []string{NormalizeAlias(client.Name)}
	for _, alias := range in.Aliases {
		normalized := NormalizeAlias(alias)
		if normalized != "" && !slices.Contains(aliases, normalized) {
			aliases = append(aliases, normalized)
		}
	}
	client.Aliases = aliases

	return client, nil
}

// checkAliases rejects an alias another client already uses, since the
// calendar sync could not tell the two apart.
func checkAliases(client Client, existing []Client) error {
	for _, other := range existing {
		if other.ID == client.ID {
			continue
		}
		for _, alias := range client.Aliases {
			if slices.Contains(other.Aliases, alias) {
				return apperr.Conflict("%q is already used by %s", alias, other.Name)
			}
		}
	}
	return nil
}

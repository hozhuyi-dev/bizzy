package clients

import (
	"context"
	"encoding/json"
	"slices"
	"strings"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

type store interface {
	List(ctx context.Context) ([]Client, error)
	Put(ctx context.Context, client Client) error
}

type handler struct {
	repo store
}

func Register(r *router.Router, repo store) {
	h := handler{repo: repo}
	r.Register("clients.list", h.list)
	r.Register("clients.save", router.Typed(h.save))
}

func (h handler) list(ctx context.Context, _ json.RawMessage) (any, error) {
	return h.repo.List(ctx)
}

// save creates a client when ID is empty, otherwise replaces it.
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

	if client.ID == "" {
		client.ID = dynamo.NewID()
	}
	if err := h.repo.Put(ctx, client); err != nil {
		return nil, err
	}

	return client, nil
}

// prepare validates a client and normalises its aliases, making sure the
// client's own name is one of them.
func prepare(in Client) (Client, error) {
	client := in
	client.Name = strings.Join(strings.Fields(in.Name), " ")
	client.Email = strings.TrimSpace(in.Email)

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

package clients

import (
	"fmt"
	"slices"

	"bizzy-lambda/internal/platform/txn"
)

// Invariants are what holds for every client, always (see txn.Invariant).
var Invariants = []txn.Invariant{
	{
		ID: "clients-have-a-name", Why: "Every client has a name to show and to match titles by",
		On: Clients.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			c, ok, err := Clients.Find(tx, id)
			if ok && Normalize(c.Name) == "" {
				return []string{"client " + id + " has no name"}, err
			}
			return nil, err
		},
	},
	{
		ID: "names-name-one-client", Why: "A name in a calendar title means one client, never two",
		On: Clients.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			c, ok, err := Clients.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			if err := namesTaken(tx, c); err != nil {
				return []string{fmt.Sprintf("client %s: %v", id, err)}, nil
			}
			return nil, nil
		},
	},
	{
		ID: "fees-not-negative", Why: "A client's usual fee is never negative",
		On: Clients.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			c, ok, err := Clients.Find(tx, id)
			if ok && c.FeeCents != nil && *c.FeeCents < 0 {
				return []string{fmt.Sprintf("client %s has a negative fee", id)}, err
			}
			return nil, err
		},
	},
	{
		ID: "client-defaults-are-clients", Why: "Whom a client's packages are shared with, and who pays for them, are other clients",
		On:     Clients.Name,
		Broken: defaultsBroken,
	},
}

// defaultsBroken is what breaks a client's defaults naming other clients:
// theirs, or for one deleted, any other's naming them.
func defaultsBroken(tx *txn.Tx, id string) ([]string, error) {
	c, ok, err := Clients.Find(tx, id)
	if err != nil {
		return nil, err
	}
	var out []string
	if !ok {
		all, err := Clients.All(tx)
		for _, other := range all {
			if other.BillTo == id || slices.Contains(other.SharesWith, id) {
				out = append(out, fmt.Sprintf("client %s names %s, who was deleted", other.ID, id))
			}
		}
		return out, err
	}
	named := slices.Clone(c.SharesWith)
	if c.BillTo != "" {
		named = append(named, c.BillTo)
	}
	for i, other := range c.SharesWith {
		if slices.Index(c.SharesWith, other) != i {
			out = append(out, fmt.Sprintf("client %s shares with %s twice", id, other))
		}
	}
	for _, other := range named {
		if other == id {
			out = append(out, fmt.Sprintf("client %s names themselves", id))
		} else if _, found, err := Clients.Find(tx, other); err != nil {
			return nil, err
		} else if !found {
			out = append(out, fmt.Sprintf("client %s names %q, who isn't a client", id, other))
		}
	}
	return out, nil
}

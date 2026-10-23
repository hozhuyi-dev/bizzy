package clients

import (
	"fmt"

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
}

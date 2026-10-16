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
		ID: "fees-in-order", Why: "A client's fees run in order: the first from the start, each later one from a day of its own",
		On: Clients.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			c, ok, err := Clients.Find(tx, id)
			if ok {
				if bad := checkFeeRates(c.FeeRates); bad != nil {
					return []string{fmt.Sprintf("client %s: %v", id, bad)}, err
				}
			}
			return nil, err
		},
	},
}

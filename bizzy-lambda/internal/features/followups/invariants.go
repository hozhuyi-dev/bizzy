package followups

import (
	"fmt"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/platform/txn"
)

// Invariants are what holds for every follow-up, always.
var Invariants = []txn.Invariant{
	{
		ID: "follow-ups-are-a-clients", Why: "Every follow-up is for one of the clients",
		On: FollowUps.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			fu, ok, err := FollowUps.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			if _, found, err := clients.Clients.Find(tx, fu.ClientID); err != nil || !found {
				return []string{fmt.Sprintf("follow-up %s is for %q, who isn't a client", id, fu.ClientID)}, err
			}
			return nil, nil
		},
	},
	{
		ID: "clients-keep-their-follow-ups", Why: "A client with follow-ups isn't deleted",
		On: clients.Clients.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			if _, ok, err := clients.Clients.Find(tx, id); err != nil || ok {
				return nil, err
			}
			if has, err := FollowUps.HasClient(tx, id); err != nil || has {
				return []string{"client " + id + " was deleted with follow-ups"}, err
			}
			return nil, nil
		},
	},
	{
		ID: "follow-ups-are-due-sometime", Why: "A follow-up is due on a day, or at a time for a while",
		On: FollowUps.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			fu, ok, err := FollowUps.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			if fu.Due.IsZero() || fu.AllDay != (fu.Minutes == 0) || time.Duration(fu.Minutes)*time.Minute > 12*time.Hour {
				return []string{fmt.Sprintf("follow-up %s is due %v for %d minutes", id, fu.Due, fu.Minutes)}, nil
			}
			return nil, nil
		},
	},
}

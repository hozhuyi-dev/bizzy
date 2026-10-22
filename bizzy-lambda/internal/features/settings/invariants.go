package settings

import "bizzy-lambda/internal/platform/txn"

// Invariants are what holds for the settings, always.
var Invariants = []txn.Invariant{
	{
		ID: "look-ahead-in-range", Why: "The to-do list reads at most MaxAheadDays ahead",
		On: Store.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			s, ok, err := Store.Find(tx, id)
			if ok && checkAhead(*s) != nil {
				return []string{"settings look too far ahead"}, err
			}
			return nil, err
		},
	}, {
		ID: "pay-page-showable", Why: "The payment page draws the QR and lists the apps as saved",
		On: Store.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			s, ok, err := Store.Find(tx, id)
			if ok && checkPay(*s) != nil {
				return []string{checkPay(*s).Error()}, err
			}
			return nil, err
		},
	},
}

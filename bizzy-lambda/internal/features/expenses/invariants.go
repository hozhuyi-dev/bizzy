package expenses

import (
	"fmt"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/platform/txn"
)

// Invariants are what holds for every expense, always.
var Invariants = []txn.Invariant{
	{
		ID: "expenses-are-spent-on-items", Why: "An expense is something bought: lines in a category, coming to more than nothing",
		On: Expenses.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			e, ok, err := Expenses.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			if len(e.Lines) == 0 || e.TotalCents() <= 0 {
				return []string{"expense " + id + " is of nothing"}, nil
			}
			cats, err := CategoriesOf(tx)
			if err != nil {
				return nil, err
			}
			var out []string
			for _, l := range e.Lines {
				if !hasCategory(cats, l.CategoryID) {
					out = append(out, fmt.Sprintf("expense %s files %s under %s, which isn't a category", id, l.Name, l.CategoryID))
				}
			}
			return out, nil
		},
	},
	{
		ID: "receipts-are-an-expenses", Why: "A receipt's file is an expense's, and goes with it",
		On: Expenses.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			if _, ok, err := Expenses.Find(tx, id); err != nil || ok {
				return nil, err
			}
			if n, err := attachments.Count(tx, attachments.OwnerExpense, id); err != nil || n > 0 {
				return []string{"deleted expense " + id + " left its files"}, err
			}
			return nil, nil
		},
	},
	{
		ID: "items-are-filed", Why: "Every item is in a category",
		On: Items.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			it, ok, err := Items.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			cats, err := CategoriesOf(tx)
			if err == nil && !hasCategory(cats, it.CategoryID) {
				return []string{fmt.Sprintf("item %s is filed under %s, which isn't a category", id, it.CategoryID)}, nil
			}
			return nil, err
		},
	},
	{
		ID: "items-are-one-per-name", Why: "An item is listed once, however its name was typed",
		On: Items.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			it, ok, err := Items.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			all, err := Items.All(tx)
			for _, other := range all {
				if other.ID != id && normalizeName(other.Name) == normalizeName(it.Name) {
					return []string{fmt.Sprintf("items %s and %s are both %q", id, other.ID, it.Name)}, err
				}
			}
			return nil, err
		},
	},
	{
		ID: "vendors-are-one-per-name", Why: "A shop is listed once, however its name was typed",
		On: Vendors.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			v, ok, err := Vendors.Find(tx, id)
			if err != nil || !ok {
				return nil, err
			}
			all, err := Vendors.All(tx)
			for _, other := range all {
				if other.ID != id && normalizeName(other.Name) == normalizeName(v.Name) {
					return []string{fmt.Sprintf("vendors %s and %s are both %q", id, other.ID, v.Name)}, err
				}
			}
			return nil, err
		},
	},
	{
		ID: "receipts-are-an-expenses", Why: "A receipt's file is an expense's, and goes with it",
		On: attachments.Attachments.Name,
		Broken: func(tx *txn.Tx, id string) ([]string, error) {
			a, ok, err := attachments.Attachments.Find(tx, id)
			if err != nil || !ok || a.OwnerKind != attachments.OwnerExpense {
				return nil, err
			}
			if _, found, err := Expenses.Find(tx, a.OwnerID); err != nil || !found {
				return []string{fmt.Sprintf("file %s is attached to expense %s, which doesn't exist", id, a.OwnerID)}, err
			}
			return nil, nil
		},
	},
}

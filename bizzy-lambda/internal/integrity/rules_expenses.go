package integrity

import (
	"fmt"
	"slices"

	"bizzy-lambda/internal/features/expenses"
)

// ExpenseLinks are the rules between expenses, the items on their lines and
// the categories those are filed under.
var ExpenseLinks = []Rule{
	{
		ID:  "line-item-exists",
		Why: "Every line on an expense names an item in the list",
		Broken: func(w World) []string {
			var out []string
			for _, id := range sortedKeys(w.Expenses) {
				for i, l := range w.Expenses[id].Lines {
					if _, ok := w.Items[l.ItemID]; !ok {
						out = append(out, fmt.Sprintf("expense %s line %d names item %q, which doesn't exist", id, i+1, l.ItemID))
					}
				}
			}
			return out
		},
		GuardedBy:      []string{"expenses.save"},
		ByConstruction: "an item is never deleted, only archived",
	},
	{
		ID:  "filed-under-a-category",
		Why: "Every line and item is filed under a category that exists",
		Broken: func(w World) []string {
			categories := w.Categories
			if categories == nil {
				categories = expenses.DefaultCategories
			}
			exists := func(id string) bool {
				return slices.ContainsFunc(categories, func(c expenses.Category) bool { return c.ID == id })
			}
			var out []string
			for _, id := range sortedKeys(w.Expenses) {
				for i, l := range w.Expenses[id].Lines {
					if !exists(l.CategoryID) {
						out = append(out, fmt.Sprintf("expense %s line %d is filed under %q, which doesn't exist", id, i+1, l.CategoryID))
					}
				}
			}
			for _, id := range sortedKeys(w.Items) {
				if c := w.Items[id].CategoryID; !exists(c) {
					out = append(out, fmt.Sprintf("item %s is filed under %q, which doesn't exist", id, c))
				}
			}
			return out
		},
		GuardedBy:      []string{"expenses.save", "expenses.saveItem", "expenses.saveCategories"},
		ByConstruction: "a category is never deleted, only archived",
	},
}

package migrations

import "bizzy-lambda/internal/platform/migrate"

// rememberedListsAndSessionPay drops the item id from each expense line:
// a line keeps the name and category it was typed with, and the list of
// items only remembers names, to suggest them. And it says how each
// session is paid for, which was worked out from its credits: by package
// when credits pay for some of it, else by its fee.
var rememberedListsAndSessionPay = migrate.Migration{
	Name: "expense lines keep their name, not an item id; sessions say how they are paid",
	Up: func(m *migrate.Tx) error {
		err := migrate.EachItem("EXPENSE", func(_ string, f migrate.Fields) (bool, error) {
			lines, _ := f["lines"].([]any)
			changed := false
			for _, l := range lines {
				if line, ok := l.(map[string]any); ok {
					if _, has := line["itemId"]; has {
						delete(line, "itemId")
						changed = true
					}
				}
			}
			return changed, nil
		})(m)
		if err != nil {
			return err
		}
		return migrate.EachItem("SESSION", func(_ string, f migrate.Fields) (bool, error) {
			if _, has := f["pay"]; has {
				return false, nil
			}
			by := "fee"
			if credits, _ := f["credits"].([]any); len(credits) > 0 {
				by = "package"
			}
			f["pay"] = map[string]any{"by": by}
			return true, nil
		})(m)
	},
}

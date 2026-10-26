package migrations

import "bizzy-lambda/internal/platform/migrate"

// paymentPerLine moves a receipt's payment onto each of its lines, so that
// receipts of different payments can be put on one, each item keeping how
// and when it was paid. paidBy, the method as named and no longer
// printed, goes. It changes documents (their issued content and draft)
// and the revisions kept; what an issued PDF prints is unchanged.
var paymentPerLine = migrate.Migration{
	Name: "move a receipt's payment onto its lines",
	Up: func(m *migrate.Tx) error {
		err := migrate.EachItem("DOC", func(_ string, f migrate.Fields) (bool, error) {
			content, draft := paymentOnLines(f["content"]), paymentOnLines(f["draft"])
			return content || draft, nil
		})(m)
		if err != nil {
			return err
		}
		return migrate.EachItem("DOCREV", func(_ string, f migrate.Fields) (bool, error) {
			return paymentOnLines(f["content"]), nil
		})(m)
	},
}

// paymentOnLines gives every line of stored content the content's
// payment, and drops it and paidBy from the content. It says whether it
// changed anything.
func paymentOnLines(stored any) bool {
	content, ok := stored.(map[string]any)
	if !ok {
		return false
	}
	payment, paid := content["payment"]
	_, named := content["paidBy"]
	if !paid && !named {
		return false
	}
	if lines, ok := content["lines"].([]any); ok && payment != nil {
		for _, l := range lines {
			if line, ok := l.(map[string]any); ok {
				line["payment"] = payment
			}
		}
	}
	delete(content, "payment")
	delete(content, "paidBy")
	return true
}

package migrations

import (
	"encoding/json"

	"bizzy-lambda/internal/platform/migrate"
)

// linkClients files each document link by whom its item is for, so a
// client's documents include those someone else pays. Until now every
// line was its payer's own, so that is the client of the document the link
// points at. The rest of what came with payers and shared packages (whom
// a line is for, a package's SharedWith, a client's defaults, a
// recipient's RegNo) is new and optional: no item has it yet.
var linkClients = migrate.Migration{
	Name: "file document links by whom their item is for",
	Up: func(m *migrate.Tx) error {
		payer := map[string]string{}
		err := m.Each("DOC", func(id string, data []byte) error {
			var d struct {
				ClientID string `json:"clientId"`
			}
			if err := json.Unmarshal(data, &d); err != nil {
				return err
			}
			payer[id] = d.ClientID
			return nil
		})
		if err != nil {
			return err
		}
		return migrate.EachItem("DOCLINK", func(_ string, f migrate.Fields) (bool, error) {
			if _, done := f["clientId"]; done {
				return false, nil
			}
			doc, _ := f["documentId"].(string)
			f["clientId"] = payer[doc]
			return true, nil
		})(m)
	},
}

package documents_test

import (
	"slices"
	"testing"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/platform/listing"
)

// One list of every type, narrowed by type, client, status and what is
// still owed; drafts without a date are in it too.
func TestSearchAcrossTypes(t *testing.T) {
	a, jane, ss := setup(t)
	in := map[string]any{"items": []map[string]any{{"kind": "session", "id": ss[0].ID}}, "payment": map[string]any{"method": "cash"}}
	if err := a.Must("payments.set", in, nil); err != nil {
		t.Fatal(err)
	}
	search := func(in map[string]any) (ids []string, types []documents.Type) {
		t.Helper()
		var page listing.Page[documents.Summary]
		if err := a.Must("documents.search", in, &page); err != nil {
			t.Fatal(err)
		}
		for _, d := range page.Items {
			ids = append(ids, d.ID)
			if !slices.Contains(types, d.Type) {
				types = append(types, d.Type)
			}
		}
		return ids, types
	}

	all, types := search(map[string]any{})
	if len(all) != 4 || len(types) != 2 {
		t.Errorf("every document = %v (%v), want three draft invoices and a draft receipt", all, types)
	}
	if mine, _ := search(map[string]any{"clientIds": []string{jane}, "statuses": []string{"draft"}}); len(mine) != 4 {
		t.Errorf("jane's drafts = %v", mine)
	}
	if receipts, types := search(map[string]any{"types": []string{"receipt"}}); len(receipts) != 1 || types[0] != documents.TypeReceipt {
		t.Errorf("receipts = %v", receipts)
	}
	unpaid, _ := search(map[string]any{"types": []string{"invoice"}, "unpaid": true})
	slices.Sort(unpaid)
	if want := []string{ss[1].Invoice.ID, ss[2].Invoice.ID}; !slices.Equal(unpaid, want) {
		t.Errorf("unpaid invoices = %v, want %v (the paid one left out)", unpaid, want)
	}
	if _, refused, _ := a.Call("documents.search", map[string]any{"types": []string{"quote"}}); refused == nil {
		t.Error("an unknown type is searched for")
	}
}

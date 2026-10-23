package expenses_test

import (
	"testing"

	"bizzy-lambda/internal/features/expenses"
	"bizzy-lambda/internal/testutil/testapp"
)

func TestVendorsAreSuggestedLastUsedFirst(t *testing.T) {
	a := testapp.New()
	save := func(day, vendor string) {
		t.Helper()
		in := map[string]any{"date": day, "vendor": vendor, "lines": []map[string]any{
			{"name": "Kinesio tape", "categoryId": "purchases", "amountCents": 2500},
		}}
		if err := a.Must("expenses.create", in, nil); err != nil {
			t.Fatal(err)
		}
	}
	catalogue := func() expenses.CatalogueView {
		t.Helper()
		var c expenses.CatalogueView
		if err := a.Must("expenses.catalogue", nil, &c); err != nil {
			t.Fatal(err)
		}
		return c
	}

	save("2026-10-01", "Shopee")
	save("2026-10-05", "Guardian")
	save("2026-10-09", "  shopee ") // the same shop, typed another way
	save("2026-09-01", "Guardian")  // an older receipt leaves its last use
	save("2026-10-10", "")

	c := catalogue()
	if len(c.Vendors) != 2 || c.Vendors[0].Name != "Shopee" || c.Vendors[0].LastUsed != "2026-10-09" ||
		c.Vendors[1].Name != "Guardian" || c.Vendors[1].LastUsed != "2026-10-05" {
		t.Fatalf("vendors %+v, want Shopee then Guardian", c.Vendors)
	}

	if err := a.Must("expenses.archiveVendor", map[string]any{"id": c.Vendors[1].ID, "archived": true}, nil); err != nil {
		t.Fatal(err)
	}
	if v := catalogue().Vendors[1]; !v.Archived {
		t.Errorf("%s isn't archived", v.Name)
	}
}

// By shop, however its name was typed, and by whether a receipt is kept;
// the totals count only what is found.
func TestSearchByShopAndReceipt(t *testing.T) {
	a := testapp.New()
	for _, vendor := range []string{"Shopee", "  shopee ", "Guardian"} {
		in := map[string]any{"date": "2026-10-01", "vendor": vendor, "lines": []map[string]any{
			{"name": "Kinesio tape", "categoryId": "purchases", "amountCents": 2500},
		}}
		if err := a.Must("expenses.create", in, nil); err != nil {
			t.Fatal(err)
		}
	}
	search := func(in map[string]any) expenses.SearchView {
		t.Helper()
		var out expenses.SearchView
		if err := a.Must("expenses.search", in, &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	if got := search(map[string]any{"vendors": []string{"SHOPEE"}}); len(got.Items) != 2 || got.Totals.Count != 2 || got.Totals.SpentCents != 5000 {
		t.Errorf("Shopee's = %d items, totals %+v", len(got.Items), got.Totals)
	}
	if got := search(map[string]any{"receipts": []string{expenses.ReceiptMissing}}); len(got.Items) != 3 {
		t.Errorf("missing a receipt = %d, want every one", len(got.Items))
	}
	if got := search(map[string]any{"receipts": []string{expenses.ReceiptKept}}); len(got.Items) != 0 || got.Totals.Count != 0 {
		t.Errorf("with a receipt = %d, totals %+v", len(got.Items), got.Totals)
	}
}

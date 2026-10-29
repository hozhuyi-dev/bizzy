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

	guardian := c.Vendors[1]
	if err := a.Must("expenses.saveVendor", map[string]any{"id": guardian.ID, "name": "Guardian Pharmacy", "archived": true}, nil); err != nil {
		t.Fatal(err)
	}
	if v := catalogue().Vendors[1]; !v.Archived || v.Name != "Guardian Pharmacy" {
		t.Errorf("%+v, want renamed and archived", v)
	}
	// Renamed in the list only: the receipts say what was typed on them.
	var found expenses.SearchView
	if err := a.Must("expenses.search", map[string]any{"vendors": []string{"Guardian"}}, &found); err != nil {
		t.Fatal(err)
	}
	if len(found.Items) != 2 {
		t.Errorf("Guardian's receipts = %d, want 2", len(found.Items))
	}
	// One name per shop.
	_, refused, err := a.Call("expenses.saveVendor", map[string]any{"id": guardian.ID, "name": "SHOPEE"})
	if err != nil || refused == nil {
		t.Errorf("renaming to Shopee: refused %+v, err %v", refused, err)
	}
}

// The list remembers each name typed, with the category and amount it
// had last; renaming an item changes the list, not the receipts.
func TestItemsAreRememberedByName(t *testing.T) {
	a := testapp.New()
	save := func(name, category string, cents int64) {
		t.Helper()
		in := map[string]any{"date": "2026-10-01", "lines": []map[string]any{{"name": name, "categoryId": category, "amountCents": cents}}}
		if err := a.Must("expenses.create", in, nil); err != nil {
			t.Fatal(err)
		}
	}
	save("Kinesio tape", "purchases", 2500)
	save(" kinesio  TAPE", "other", 3000)
	var c expenses.CatalogueView
	if err := a.Must("expenses.catalogue", nil, &c); err != nil {
		t.Fatal(err)
	}
	if len(c.Items) != 1 || c.Items[0].Name != "Kinesio tape" || c.Items[0].CategoryID != "other" || *c.Items[0].LastAmountCents != 3000 {
		t.Fatalf("items %+v, want tape once, as last typed", c.Items)
	}
	tape := c.Items[0]
	if err := a.Must("expenses.saveItem", map[string]any{"id": tape.ID, "name": "Tape", "categoryId": "purchases"}, nil); err != nil {
		t.Fatal(err)
	}
	var found expenses.SearchView
	if err := a.Must("expenses.search", map[string]any{"items": []string{"kinesio tape"}}, &found); err != nil {
		t.Fatal(err)
	}
	if len(found.Items) != 2 || found.Totals.SpentCents != 5500 || found.Items[0].Lines[0].Name == "Tape" {
		t.Errorf("found %d, totals %+v: want both receipts as typed", len(found.Items), found.Totals)
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

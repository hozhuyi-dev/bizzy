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

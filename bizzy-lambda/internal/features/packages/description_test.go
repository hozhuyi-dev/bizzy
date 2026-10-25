package packages_test

import (
	"strings"
	"testing"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/testutil/testapp"
)

// A package's line says how many sessions it is, as clients count them, on
// its invoice and on its receipt, and follows a change to its size while
// both are drafts.
func TestLineCountsSessions(t *testing.T) {
	a := testapp.New()
	jane, err := a.Client("Jane Smith", nil)
	if err != nil {
		t.Fatal(err)
	}
	var pkg packages.View
	in := map[string]any{"clientId": jane, "hours": 10, "priceCents": 85000, "purchasedAt": testapp.Epoch}
	if err := a.Must("packages.create", in, &pkg); err != nil {
		t.Fatal(err)
	}
	paid := map[string]any{"items": []map[string]any{{"kind": "package", "id": pkg.ID}}, "payment": map[string]any{"method": "cash"}}
	if err := a.Must("payments.set", paid, nil); err != nil {
		t.Fatal(err)
	}

	lines := func() (invoice, receipt string) {
		t.Helper()
		var all []packages.View
		if err := a.Must("packages.list", map[string]any{"all": true}, &all); err != nil {
			t.Fatal(err)
		}
		for _, p := range all {
			if p.ID != pkg.ID {
				continue
			}
			read := func(id string) string {
				var d documents.View
				if err := a.Must("documents.get", map[string]any{"id": id}, &d); err != nil {
					t.Fatal(err)
				}
				return d.Draft.Lines[0].Description
			}
			return read(p.Invoice.ID), read(p.Paid.ReceiptID)
		}
		t.Fatal("the package isn't listed")
		return "", ""
	}

	invoice, receipt := lines()
	if !strings.HasSuffix(invoice, " package (10 sessions)") || receipt != invoice {
		t.Errorf("lines: invoice %q, receipt %q", invoice, receipt)
	}
	if err := a.Must("packages.update", map[string]any{"id": pkg.ID, "hours": 1}, nil); err != nil {
		t.Fatal(err)
	}
	if invoice, receipt := lines(); !strings.HasSuffix(invoice, " package (1 session)") || receipt != invoice {
		t.Errorf("resized: invoice %q, receipt %q", invoice, receipt)
	}
}

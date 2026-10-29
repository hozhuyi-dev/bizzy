package documents_test

import (
	"slices"
	"testing"
	"time"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/platform/listing"
	"bizzy-lambda/internal/testutil/testapp"
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
	// A cancelled one shows only when asked for.
	inv := ss[2].Invoice.ID
	if err := a.Must("documents.issue", map[string]any{"id": inv}, nil); err != nil {
		t.Fatal(err)
	}
	if err := a.Must("documents.cancel", map[string]any{"id": inv, "reason": "Wrong client"}, nil); err != nil {
		t.Fatal(err)
	}
	if ids, _ := search(map[string]any{}); slices.Contains(ids, inv) {
		t.Errorf("every document = %v, want the cancelled one left out", ids)
	}
	if ids, _ := search(map[string]any{"statuses": []string{"cancelled"}}); !slices.Equal(ids, []string{inv}) {
		t.Errorf("cancelled = %v", ids)
	}
}

// A draft is filed by the latest session on it, not when it was made, so
// it sits with its sessions; moving the session moves it.
func TestDraftsFiledBySessions(t *testing.T) {
	a, jane, ss := setup(t)
	invoices := func() []string {
		t.Helper()
		var page listing.Page[documents.Summary]
		if err := a.Must("documents.search", map[string]any{"types": []string{"invoice"}}, &page); err != nil {
			t.Fatal(err)
		}
		var ids []string
		for _, d := range page.Items {
			ids = append(ids, d.ID)
			if day := d.FiledAt.Format(time.DateOnly); day != d.Covers.To {
				t.Errorf("%s filed on %s, want its session's day %s", d.ID, day, d.Covers.To)
			}
		}
		return ids
	}
	if got, want := invoices(), []string{ss[2].Invoice.ID, ss[1].Invoice.ID, ss[0].Invoice.ID}; !slices.Equal(got, want) {
		t.Errorf("invoices = %v, want the latest session's first %v", got, want)
	}

	later := testapp.Epoch.Add(10 * 24 * time.Hour)
	in := map[string]any{"id": ss[0].ID, "time": map[string]any{"start": later, "end": later.Add(time.Hour)}}
	if err := a.Must("sessions.update", in, nil); err != nil {
		t.Fatal(err)
	}
	if got := invoices(); len(got) == 0 || got[0] != ss[0].Invoice.ID {
		t.Errorf("invoices = %v, want the moved session's first", got)
	}
	if mine := listed(t, a, jane); len(mine) == 0 || mine[0].ID != ss[0].Invoice.ID {
		t.Errorf("jane's documents start with %v, want the moved session's invoice", mine)
	}
}

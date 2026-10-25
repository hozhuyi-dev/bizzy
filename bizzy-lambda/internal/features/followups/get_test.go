package followups_test

import (
	"testing"

	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/testutil/testapp"
)

// A follow-up's page reads it alone, as it was saved; one gone is not found.
func TestGet(t *testing.T) {
	a := testapp.New()
	jane, err := a.Client("Jane Smith", nil)
	if err != nil {
		t.Fatal(err)
	}
	var made followups.View
	in := map[string]any{"clientId": jane, "when": map[string]any{"date": "2026-10-20"}, "summary": "Check MRI results"}
	if err := a.Must("followUps.create", in, &made); err != nil {
		t.Fatal(err)
	}

	var got followups.View
	if err := a.Must("followUps.get", map[string]any{"id": made.ID}, &got); err != nil {
		t.Fatal(err)
	}
	if got.ID != made.ID || got.Summary != "Check MRI results" || got.ClientName != "Jane Smith" {
		t.Errorf("got %+v, want the follow-up made", got)
	}

	if err := a.Must("followUps.delete", map[string]any{"id": made.ID}, nil); err != nil {
		t.Fatal(err)
	}
	if _, refused, err := a.Call("followUps.get", map[string]any{"id": made.ID}); err == nil && refused == nil {
		t.Error("a deleted follow-up still reads")
	}
}

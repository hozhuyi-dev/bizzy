package followups_test

import (
	"slices"
	"testing"

	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/platform/listing"
	"bizzy-lambda/internal/testutil/testapp"
)

// One list, narrowed by how each stands: open soonest first (overdue
// among them), done ones latest first, or all of them.
func TestSearchByStatus(t *testing.T) {
	a := testapp.New() // 13 Oct 2026
	jane, err := a.Client("Jane Smith", nil)
	if err != nil {
		t.Fatal(err)
	}
	create := func(date string) string {
		var fu followups.View
		in := map[string]any{"clientId": jane, "when": map[string]any{"date": date}, "summary": "Call " + date}
		if err := a.Must("followUps.create", in, &fu); err != nil {
			t.Fatal(err)
		}
		return fu.ID
	}
	overdue := create("2026-10-01")
	soon := create("2026-10-20")
	later := create("2026-11-20")
	done := create("2026-09-01")
	if err := a.Must("followUps.setDone", map[string]any{"id": done, "done": true}, nil); err != nil {
		t.Fatal(err)
	}

	search := func(statuses ...string) []string {
		t.Helper()
		var page listing.Page[followups.View]
		if err := a.Must("followUps.search", map[string]any{"statuses": statuses}, &page); err != nil {
			t.Fatal(err)
		}
		var ids []string
		for _, fu := range page.Items {
			ids = append(ids, fu.ID)
		}
		return ids
	}
	for _, c := range []struct {
		statuses []string
		want     []string
	}{
		{[]string{"open"}, []string{overdue, soon, later}},
		{[]string{"overdue"}, []string{overdue}},
		{[]string{"done"}, []string{done}},
		{nil, []string{later, soon, overdue, done}},
	} {
		if got := search(c.statuses...); !slices.Equal(got, c.want) {
			t.Errorf("%v = %v, want %v", c.statuses, got, c.want)
		}
	}
	if _, refused, _ := a.Call("followUps.search", map[string]any{"statuses": []string{"later"}}); refused == nil {
		t.Error("an unknown status is searched for")
	}
}

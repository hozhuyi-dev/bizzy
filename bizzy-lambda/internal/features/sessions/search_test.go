package sessions_test

import (
	"slices"
	"testing"

	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/listing"
	"bizzy-lambda/internal/testutil/testapp"
)

func search(t *testing.T, a *testapp.App, in map[string]any) listing.Page[sessions.Hit] {
	t.Helper()
	var page listing.Page[sessions.Hit]
	if err := a.Must("sessions.search", in, &page); err != nil {
		t.Fatal(err)
	}
	return page
}

func hitIDs(page listing.Page[sessions.Hit]) []string {
	var out []string
	for _, h := range page.Items {
		out = append(out, h.ID)
	}
	return out
}

func TestSearchFindsSessionsByTheirNotes(t *testing.T) {
	a, jane, bob := setup(t)
	// Three weeks back: Jane's knee, Bob's shoulder, Jane again.
	old := create(t, a, book(jane, -21*24, -21*24+1, nil))
	mid := create(t, a, book(bob, -14*24, -14*24+1, fee(8000)))
	recent := create(t, a, book(jane, -7*24, -7*24+1, nil))
	for id, record := range map[string][2]string{
		old.ID:    {"Knee rehab", "Pain in the left knee after running; ice and rest."},
		mid.ID:    {"Shoulder", "Frozen shoulder, range of motion improving."},
		recent.ID: {"", "Left KNEE better. Start squats next week."},
	} {
		in := map[string]any{"id": id, "summary": record[0], "notes": record[1]}
		if err := a.Must("sessions.saveRecord", in, nil); err != nil {
			t.Fatal(err)
		}
	}

	// Latest first; the notes are searched, and say why.
	knee := search(t, a, map[string]any{"text": "knee"})
	if !slices.Equal(hitIDs(knee), []string{recent.ID, old.ID}) {
		t.Fatalf("knee = %v, want %s then %s", hitIDs(knee), recent.ID, old.ID)
	}
	if knee.Items[0].Excerpt != "Left KNEE better. Start squats next week." || knee.Items[1].Excerpt != "" {
		t.Errorf("excerpts = %q, %q; want the notes only where the summary didn't have it", knee.Items[0].Excerpt, knee.Items[1].Excerpt)
	}
	// Every word, anywhere: the client's name and the notes.
	if got := hitIDs(search(t, a, map[string]any{"text": "bob motion"})); !slices.Equal(got, []string{mid.ID}) {
		t.Errorf("bob motion = %v", got)
	}
	// By client, by days, and by what is left to do.
	if got := hitIDs(search(t, a, map[string]any{"clientIds": []string{jane}})); !slices.Equal(got, []string{recent.ID, old.ID}) {
		t.Errorf("jane's = %v", got)
	}
	twoWeeks := map[string]any{"from": at(-15 * 24).In(testapp.KL).Format("2006-01-02"), "to": at(0).In(testapp.KL).Format("2006-01-02")}
	if got := hitIDs(search(t, a, twoWeeks)); !slices.Equal(got, []string{recent.ID, mid.ID}) {
		t.Errorf("last two weeks = %v", got)
	}
	if got := hitIDs(search(t, a, map[string]any{"todo": []string{"collect"}, "clientIds": []string{bob}})); !slices.Equal(got, []string{mid.ID}) {
		t.Errorf("bob's to collect = %v", got)
	}

	// A page at a time.
	first := search(t, a, map[string]any{"limit": 2})
	second := search(t, a, map[string]any{"limit": 2, "after": first.Next})
	if !slices.Equal(hitIDs(first), []string{recent.ID, mid.ID}) || !slices.Equal(hitIDs(second), []string{old.ID}) || second.Next != "" {
		t.Errorf("pages = %v, %v (next %q)", hitIDs(first), hitIDs(second), second.Next)
	}
}

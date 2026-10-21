package timeline_test

import (
	"fmt"
	"slices"
	"testing"
	"time"

	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/timeline"
	"bizzy-lambda/internal/platform/listing"
	"bizzy-lambda/internal/testutil/testapp"
)

func must(t *testing.T, a *testapp.App, action string, in, out any) {
	t.Helper()
	if err := a.Must(action, in, out); err != nil {
		t.Fatal(err)
	}
}

// story is Jane's: three sessions that happened (the first two on one
// invoice), one booked, a follow-up made from the second, a call done on
// its own, and a package bought on its own between them.
func story(t *testing.T) (*testapp.App, string, []sessions.View) {
	t.Helper()
	a := testapp.New()
	jane, err := a.Client("Jane Smith", map[string]any{"feeRates": []map[string]any{{"cents": 9000}}})
	if err != nil {
		t.Fatal(err)
	}
	var ss []sessions.View
	for _, hours := range []int{-72, -48, -24, 24} {
		start := testapp.Epoch.Add(time.Duration(hours) * time.Hour)
		var s sessions.View
		must(t, a, "sessions.create", map[string]any{"clientId": jane, "time": map[string]any{"start": start, "end": start.Add(time.Hour)}}, &s)
		ss = append(ss, s)
	}
	must(t, a, "documents.combine", map[string]any{"ids": []string{ss[0].Invoice.ID, ss[1].Invoice.ID}}, nil)
	must(t, a, "followUps.create", map[string]any{"clientId": jane, "sessionId": ss[1].ID, "when": map[string]any{"date": "2026-10-20"}, "summary": "Check the knee"}, nil)
	var called struct{ ID string }
	must(t, a, "followUps.create", map[string]any{"clientId": jane, "when": map[string]any{"date": "2026-10-09"}, "summary": "Call about insurance"}, &called)
	must(t, a, "followUps.setDone", map[string]any{"id": called.ID, "done": true}, nil)
	must(t, a, "packages.create", map[string]any{"clientId": jane, "hours": 5, "priceCents": 40000, "purchasedAt": testapp.Epoch.Add(-60 * time.Hour), "note": "Gift"}, nil)
	return a, jane, ss
}

// read pages through the timeline, limit sessions a page.
func read(t *testing.T, a *testapp.App, jane string, limit int, text string) []timeline.Entry {
	t.Helper()
	var out []timeline.Entry
	after := ""
	for range 20 {
		var page listing.Page[timeline.Entry]
		must(t, a, "timeline.search", map[string]any{"clientId": jane, "limit": limit, "after": after, "text": text}, &page)
		out = append(out, page.Items...)
		if after = page.Next; after == "" {
			return out
		}
	}
	t.Fatal("the timeline never ends")
	return nil
}

func label(e timeline.Entry) string {
	switch e.Kind {
	case timeline.KindSession:
		return fmt.Sprintf("session %s", e.Session.ID)
	case timeline.KindFollowUp:
		return "follow-up " + e.FollowUp.Summary
	case timeline.KindDocument:
		return fmt.Sprintf("document of %d", e.Document.Covers)
	case timeline.KindPackage:
		return "package " + e.Package.Note
	}
	return string(e.Kind)
}

func TestTimelineTellsTheStoryOnce(t *testing.T) {
	a, jane, ss := story(t)
	want := []string{
		"session " + ss[2].ID,
		"document of 2", // where its newest session is
		"session " + ss[1].ID,
		"package Gift",
		"session " + ss[0].ID,
		"follow-up Call about insurance",
	}
	for _, limit := range []int{1, 2, 50} {
		var got []string
		for _, e := range read(t, a, jane, limit, "") {
			got = append(got, label(e))
		}
		if !slices.Equal(got, want) {
			t.Errorf("%d a page:\n got %q\nwant %q", limit, got, want)
		}
	}

	entries := read(t, a, jane, 50, "")
	second := entries[2].Session
	if len(second.FollowUps) != 1 || len(second.Documents) != 1 || second.Documents[0].Others != 1 {
		t.Errorf("second session: follow-ups %+v, documents %+v", second.FollowUps, second.Documents)
	}
	if third := entries[0].Session; len(third.Documents) != 1 || third.Documents[0].Others != 0 {
		t.Errorf("third session's documents: %+v", third.Documents)
	}
}

func TestTimelineUpcoming(t *testing.T) {
	a, jane, ss := story(t)
	must(t, a, "followUps.create", map[string]any{"clientId": jane, "when": map[string]any{"date": "2026-10-01"}, "summary": "Send exercises"}, nil)
	var page timeline.Page
	must(t, a, "timeline.search", map[string]any{"clientId": jane}, &page)
	var got []string
	for _, e := range page.Upcoming {
		got = append(got, label(e))
	}
	// Newest first; the overdue one waits just above now.
	want := []string{"follow-up Check the knee", "session " + ss[3].ID, "follow-up Send exercises"}
	if !slices.Equal(got, want) {
		t.Errorf("upcoming:\n got %q\nwant %q", got, want)
	}
	var next timeline.Page
	must(t, a, "timeline.search", map[string]any{"clientId": jane, "limit": 1, "after": ""}, &next)
	if next.Next == "" {
		t.Fatal("one session a page should have a next")
	}
	var later timeline.Page
	must(t, a, "timeline.search", map[string]any{"clientId": jane, "limit": 1, "after": next.Next}, &later)
	if len(later.Upcoming) != 0 {
		t.Errorf("a later page has upcoming %d", len(later.Upcoming))
	}
}

func TestTimelineSearch(t *testing.T) {
	a, jane, ss := story(t)
	must(t, a, "sessions.saveRecord", map[string]any{"id": ss[0].ID, "summary": "Knee, better"}, nil)
	var got []string
	for _, e := range read(t, a, jane, 1, "knee") {
		got = append(got, label(e))
	}
	if want := []string{"session " + ss[0].ID}; !slices.Equal(got, want) {
		t.Errorf("knee: got %q, want %q", got, want)
	}
}

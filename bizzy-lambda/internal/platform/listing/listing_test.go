package listing_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"bizzy-lambda/internal/platform/listing"
	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
)

func TestWordsAreFoundInAnyFieldAnyCase(t *testing.T) {
	w := listing.WordsOf("  Knee, JOSE ")
	if strings.Join(w, " ") != "knee jose" {
		t.Fatalf("words = %q", w)
	}
	for _, c := range []struct {
		fields []string
		want   bool
	}{
		{[]string{"José Tan", "left knee pain"}, true},
		{[]string{"José Tan kneeling"}, true},
		{[]string{"José Tan"}, false},
		{nil, false},
	} {
		if got := w.In(c.fields...); got != c.want {
			t.Errorf("In(%q) = %v, want %v", c.fields, got, c.want)
		}
	}
	if !listing.WordsOf(" ,. ").In() {
		t.Error("no words should take everything")
	}
}

func TestExcerptShowsWhereAWordIs(t *testing.T) {
	notes := strings.Repeat("Warm up and stretch. ", 10) + "Pain in the left knee\nafter running. " + strings.Repeat("Review next week. ", 10)
	got := listing.WordsOf("KNEE").Excerpt(notes)
	if !strings.Contains(got, "left knee after running") || !strings.HasPrefix(got, "…") || !strings.HasSuffix(got, "…") {
		t.Errorf("excerpt = %q", got)
	}
	if got := listing.WordsOf("café").Excerpt("Met at the Café Rio."); got != "Met at the Café Rio." {
		t.Errorf("short text = %q, want all of it", got)
	}
	if got := listing.WordsOf("ankle").Excerpt(notes); got != "" {
		t.Errorf("no match = %q", got)
	}
}

func TestSpanIsWholeDays(t *testing.T) {
	kl := time.FixedZone("MYT", 8*60*60)
	from, to, err := listing.Request{From: "2026-10-01", To: "2026-10-31"}.Span(kl)
	if err != nil || !from.Equal(time.Date(2026, 10, 1, 0, 0, 0, 0, kl)) || !to.Equal(time.Date(2026, 10, 31, 23, 59, 59, 0, kl)) {
		t.Errorf("span = %v – %v, %v", from, to, err)
	}
	if from, to, err := (listing.Request{}).Span(kl); err != nil || !from.IsZero() || !to.IsZero() {
		t.Errorf("open span = %v – %v, %v", from, to, err)
	}
	for _, r := range []listing.Request{{From: "Oct"}, {From: "2026-10-02", To: "2026-10-01"}} {
		if _, _, err := r.Span(kl); err == nil {
			t.Errorf("%+v: no error", r)
		}
	}
}

type thing struct {
	ID string    `json:"id"`
	At time.Time `json:"at"`
}

var things = txn.Kind[thing]{Name: "THING", Meta: func(t *thing) txn.Meta { return txn.Meta{ID: t.ID, Time: t.At} }}

func TestAPageEndsFullOrAfterLookingAtTheBudget(t *testing.T) {
	ctx := context.Background()
	r := &txn.Runner{Table: table.NewMemory(), Now: time.Now, Location: time.UTC}
	day := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	const n = listing.Budget + 60
	for batch := 0; batch < n; batch += 50 {
		if _, err := txn.Run(ctx, r, func(tx *txn.Tx) (any, error) {
			for i := batch; i < min(batch+50, n); i++ {
				if err := things.Add(tx, &thing{ID: fmt.Sprintf("t%04d", i), At: day.Add(time.Duration(i) * time.Hour)}); err != nil {
					return nil, err
				}
			}
			return nil, nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	read := func(req listing.Request, take func(*thing) bool) listing.Page[string] {
		page, err := txn.Read(ctx, r, func(tx *txn.Tx) (listing.Page[string], error) {
			return listing.Read(tx, things, txn.List{Latest: true}, req, func(v *thing) (string, bool, error) { return v.ID, take(v), nil })
		})
		if err != nil {
			t.Fatal(err)
		}
		return page
	}

	full := read(listing.Request{Limit: 3}, func(*thing) bool { return true })
	if strings.Join(full.Items, " ") != fmt.Sprintf("t%04d t%04d t%04d", n-1, n-2, n-3) || full.Next == "" {
		t.Errorf("full page = %v, next %q", full.Items, full.Next)
	}
	// Only the oldest matches: the first page gives up at the budget.
	oldest := func(v *thing) bool { return v.ID == "t0000" }
	first := read(listing.Request{}, oldest)
	if len(first.Items) != 0 || first.Next == "" {
		t.Fatalf("first page = %v, next %q; want none yet, and more to look at", first.Items, first.Next)
	}
	second := read(listing.Request{After: first.Next}, oldest)
	if strings.Join(second.Items, " ") != "t0000" || second.Next != "" {
		t.Errorf("second page = %v, next %q; want t0000 and the end", second.Items, second.Next)
	}
}

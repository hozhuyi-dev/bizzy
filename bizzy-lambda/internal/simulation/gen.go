package simulation

import (
	"fmt"
	"maps"
	"slices"
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/shared/money"
)

// Generators draw inputs from the world as it is, so most actions hit
// something that exists. Keys are sorted before drawing: map order would
// make a failure impossible to replay.

// pick draws one of the keys that pass keep, or skips the action when none
// do.
func pick[V any](t *rapid.T, label string, items map[string]V, keep func(V) bool) string {
	var ids []string
	for _, id := range slices.Sorted(maps.Keys(items)) {
		if keep == nil || keep(items[id]) {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		t.Skipf("no %s to act on", label)
	}
	return rapid.SampledFrom(ids).Draw(t, label)
}

func pickSession(t *rapid.T, w *World, keep func(sessions.Session) bool) sessions.Session {
	return w.Store.SessionMap[pick(t, "session", w.Store.SessionMap, keep)]
}

func pickClientID(t *rapid.T, w *World) string {
	return pick(t, "client", w.Store.ClientMap, nil)
}

func pickPackage(t *rapid.T, w *World, keep func(packages.Package) bool) packages.Package {
	return w.Store.PackageMap[pick(t, "package", w.Store.PackageMap, keep)]
}

func pickDocument(t *rapid.T, w *World, keep func(documents.Document) bool) documents.Document {
	return w.Docs.Docs[pick(t, "document", w.Docs.Docs, keep)]
}

func pickFollowUp(t *rapid.T, w *World, keep func(followups.FollowUp) bool) followups.FollowUp {
	return w.Store.FollowUpMap[pick(t, "follow-up", w.Store.FollowUpMap, keep)]
}

// pickEvent draws a live calendar event that keep accepts.
func pickEvent(t *rapid.T, w *World, keep func(calendar.Event) bool) int {
	var idx []int
	for i, e := range w.Calendar.Live {
		if keep == nil || keep(e) {
			idx = append(idx, i)
		}
	}
	if len(idx) == 0 {
		t.Skip("no calendar event to act on")
	}
	return rapid.SampledFrom(idx).Draw(t, "event")
}

// when draws a time within a fortnight either side of now, on the hour.
func when(t *rapid.T, w *World) time.Time {
	hours := rapid.IntRange(-14*24, 14*24).Draw(t, "hours from now")
	return w.Now.Truncate(time.Hour).Add(time.Duration(hours) * time.Hour)
}

// The names written in the calendar: the clients', a near miss, a stranger,
// and one that ends like an amount.
var names = []string{"Jane Smith", "Bob Lee", "Amy Tan", "Jane Smyth", "Zed Zee", "Kid 2"}

// sessionTitle draws a session title in the calendar syntax, sometimes one
// that can't be read.
func sessionTitle(t *rapid.T) string {
	if rapid.IntRange(0, 9).Draw(t, "malformed?") == 0 {
		return rapid.SampledFrom([]string{"95", "Jane Smith 95 120", "Bob Lee 0x85", "? 120", "Jane Smith 5x80 10x80"}).Draw(t, "malformed title")
	}
	title := calendar.Title{
		Tentative: rapid.IntRange(0, 4).Draw(t, "tentative?") == 0,
		Name:      rapid.SampledFrom(names).Draw(t, "name"),
	}
	if rapid.Bool().Draw(t, "amount?") {
		title.FeeCents = rapid.SampledFrom([]*int64{cents(0), cents(9500), cents(12000)}).Draw(t, "amount")
	}
	if rapid.IntRange(0, 4).Draw(t, "package?") == 0 {
		title.Package = rapid.SampledFrom([]*calendar.PackageSpec{{Sessions: 5, PriceCents: 40000}, {Sessions: 3, PriceCents: 25000}}).Draw(t, "package")
	}
	return calendar.FormatTitle(title)
}

// followUpTitle draws a follow-up title, sometimes one with no name.
func followUpTitle(t *rapid.T) string {
	if rapid.IntRange(0, 9).Draw(t, "follow-up malformed?") == 0 {
		return "!: check knee"
	}
	return calendar.FormatFollowUp(calendar.FollowUpTitle{
		Name:    rapid.SampledFrom(names).Draw(t, "name"),
		Summary: rapid.SampledFrom([]string{"", "check knee", "send exercises"}).Draw(t, "summary"),
	})
}

// paymentInput draws how something was settled.
func paymentInput(t *rapid.T) *money.Input {
	if rapid.IntRange(0, 4).Draw(t, "waived?") == 0 {
		return &money.Input{Status: money.Waived}
	}
	method := rapid.SampledFrom(slices.Sorted(maps.Keys(money.MethodLabels))).Draw(t, "method")
	return &money.Input{Status: money.Paid, Method: method}
}

// sessionDraft draws a session as the user fills it in.
func sessionDraft(t *rapid.T, w *World) map[string]any {
	d := map[string]any{
		"clientId":  pickClientID(t, w),
		"start":     when(t, w),
		"minutes":   rapid.SampledFrom([]int{0, 45, 60}).Draw(t, "minutes"),
		"homeVisit": rapid.Bool().Draw(t, "home visit"),
		"tentative": rapid.IntRange(0, 3).Draw(t, "tentative?") == 0,
	}
	if rapid.Bool().Draw(t, "fee?") {
		d["feeCents"] = rapid.SampledFrom([]int64{0, 9500, 15000}).Draw(t, "fee")
	}
	if rapid.IntRange(0, 4).Draw(t, "package?") == 0 {
		d["package"] = map[string]any{"sessions": 5, "priceCents": 40000}
	}
	return d
}

func label(prefix string, n int) string { return fmt.Sprintf("%s%d", prefix, n) }

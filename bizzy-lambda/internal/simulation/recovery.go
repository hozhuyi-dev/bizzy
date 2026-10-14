package simulation

import (
	"cmp"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strings"
	"sync"
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/router"
	"bizzy-lambda/internal/shared/docref"
)

// Recovery: whatever state a run leaves, the user can empty the to-do list
// with the app alone. Each item is tried with the actions its rule says
// resolve it (ResolvedBy), in an order and with details drawn at random, as
// the app sends them: so over many runs, every way out is taken from many
// states. A fix may only clear the way for another (a receipt cancelled
// before its payment can change), but the list must empty within
// maxDrainRounds, and a round in which no fix is taken means she is stuck.

// maxDrainRounds bounds how many rounds of fixes the list may take to
// empty: each round can unblock the next, but never forever.
const maxDrainRounds = 30

// todoItem is one rule putting an entity on the to-do list.
type todoItem struct {
	kind, id, rule string
	resolvedBy     []string
}

func (it todoItem) String() string { return it.kind + " " + it.id + ": " + it.rule }

// todoItems is the to-do list as the app shows it: the rules that fire, by
// entity, in a stable order.
func todoItems(w *World) []todoItem {
	var out []todoItem
	for _, id := range slices.Sorted(maps.Keys(w.Store.SessionMap)) {
		out = append(out, firing("session", id, sessions.Rules, w.Store.SessionMap[id].State(w.Now))...)
	}
	for _, id := range slices.Sorted(maps.Keys(w.Store.PackageMap)) {
		out = append(out, firing("package", id, packages.Rules, w.Store.PackageMap[id].State(w.Now))...)
	}
	for _, id := range slices.Sorted(maps.Keys(w.Store.FollowUpMap)) {
		out = append(out, firing("follow-up", id, followups.Rules, w.Store.FollowUpMap[id].State())...)
	}
	return out
}

func firing[S any](kind, id string, rules statemodel.Rules[S], s S) []todoItem {
	var out []todoItem
	for _, r := range rules.Evaluate(s).Fired {
		if r.Bucket != statemodel.Impossible {
			out = append(out, todoItem{kind: kind, id: id, rule: r.ID, resolvedBy: r.ResolvedBy})
		}
	}
	return out
}

// holds says whether the item's rule still holds, hidden behind another or
// not; false once the entity is gone.
func (w *World) holds(it todoItem) bool {
	switch it.kind {
	case "session":
		s, ok := w.Store.SessionMap[it.id]
		return ok && ruleHolds(sessions.Rules, it.rule, s.State(w.Now))
	case "package":
		p, ok := w.Store.PackageMap[it.id]
		return ok && ruleHolds(packages.Rules, it.rule, p.State(w.Now))
	default:
		f, ok := w.Store.FollowUpMap[it.id]
		return ok && ruleHolds(followups.Rules, it.rule, f.State())
	}
}

func ruleHolds[S any](rules statemodel.Rules[S], id string, s S) bool {
	r, ok := rules.Find(id)
	return ok && r.When(s)
}

// everyToDoCanBeCleared empties the to-do list the way the user would,
// round by round.
func everyToDoCanBeCleared(t *rapid.T, w *World) {
	t.Helper()
	t.Logf("recovery: emptying the to-do list")
	// She opens the app, which syncs first (and repairs after a request
	// that died).
	if _, refused := w.Call(t, "sync.run", map[string]any{"all": true}, false); refused != nil {
		t.Fatalf("recovery: the sync was refused: %s", refused.Message)
	}
	w.InSync, w.unhealed = true, false
	check(t, w)

	for round := 1; ; round++ {
		open := todoItems(w)
		if len(open) == 0 {
			return
		}
		if round > maxDrainRounds {
			t.Fatalf("recovery: the to-do list never empties; still on it: %v", open)
		}
		progress := false
		var stuck []string
		for _, it := range open {
			if !w.holds(it) {
				// Cleared by fixing another item.
				progress = true
				continue
			}
			tried, took := w.resolve(t, it)
			if took {
				progress = true
				continue
			}
			stuck = append(stuck, fmt.Sprintf("  %s\n    %s", it, strings.Join(tried, "\n    ")))
		}
		if !progress {
			t.Fatalf("recovery: stuck, no fix on the to-do list can be taken:\n%s", strings.Join(stuck, "\n"))
		}
	}
}

// resolve tries the item's fixes, in a drawn order, until one is taken (the
// API accepts it and something changed), and says what each did.
func (w *World) resolve(t *rapid.T, it todoItem) (tried []string, took bool) {
	t.Helper()
	order := rapid.Permutation(it.resolvedBy).Draw(t, "fixes for "+it.rule)
	for _, action := range order {
		fix, known := resolvers[action]
		if !known {
			t.Fatalf("recovery: no way to try %s for %s; add one to resolvers", action, it)
		}
		before, held := w.snapshot(), w.contradictions()
		w.allowed = nil
		refused := fix(t, w, it)
		changed := !w.snapshot().equal(before)
		var outcome string
		switch {
		case refused != nil && refused.Code == skip:
			continue
		case refused != nil:
			outcome = fmt.Sprintf("%s refused: %s", action, refused.Message)
		case !changed:
			outcome = action + " changed nothing"
		case w.holds(it):
			outcome = "cleared the way: " + action
		default:
			outcome = "cleared by " + action
		}
		recoveries.add(it, outcome)
		tried = append(tried, outcome)
		noNewContradictions(t, action, held, w.contradictions(), w.allowed, true, nil)
		w.allowed = nil
		check(t, w)
		if refused == nil && changed {
			return tried, true
		}
	}
	return tried, false
}

// A resolver does what the app does when the user takes that action to
// clear an item, and returns the refusal if the API refused. One that
// doesn't apply to the item returns skip, sending nothing.
type resolver func(t *rapid.T, w *World, it todoItem) *router.ErrorBody

// skip is the code of a fix that doesn't apply to the item.
const skip = "skip"

var skipped = &router.ErrorBody{Code: skip}

// resolvers covers every action a to-do rule lists (see the catalogue test).
var resolvers = map[string]resolver{
	"sessions.restore": func(t *rapid.T, w *World, it todoItem) *router.ErrorBody {
		_, refused := w.Call(t, "sessions.restore", map[string]any{"eventId": it.id}, false)
		return refused
	},
	"sessions.discard": func(t *rapid.T, w *World, it todoItem) *router.ErrorBody {
		_, refused := w.Call(t, "sessions.discard", map[string]any{"eventId": it.id}, false)
		return refused
	},
	// Cancel, beside Confirm on the to-do list.
	"sessions.delete": func(t *rapid.T, w *World, it todoItem) *router.ErrorBody {
		refused := deleteSession(t, w, it.id)
		if refused != nil && w.Store.PackageMap[it.id].Source == packages.SourceCalendar {
			// The package can't go with it: she keeps it instead.
			_, refused = w.Call(t, "sessions.delete", map[string]any{"eventId": it.id, "package": "keep"}, true)
		}
		return refused
	},
	// The summary line on the to-do list.
	"sessions.saveRecord": func(t *rapid.T, w *World, it todoItem) *router.ErrorBody {
		summary := rapid.SampledFrom([]string{"Seen", "Knee review"}).Draw(t, "summary")
		_, refused := w.Call(t, "sessions.saveRecord", map[string]any{"eventId": it.id, "summary": summary}, false)
		return refused
	},
	"sessions.update":         fixBooking,
	"clients.save":            fixClient,
	"packages.save":           buyPackage,
	"packages.delete":         deletePackage,
	"packages.makeStandalone": makeStandalone,
	"payments.set":            settle,
	"documents.revise":        reviseDocuments,
	"documents.cancel":        cancelDocuments,
	"documents.discardDraft":  discardDrafts,
	"followUps.update":        fixFollowUp,
}

// fixBooking edits the session in the app, starting from the draft the API
// gives (as the session page does), and saves it once she has seen what
// that brings on: a package's booking is the session that bought it, under
// the same id.
func fixBooking(t *rapid.T, w *World, it todoItem) *router.ErrorBody {
	data, refused := w.Call(t, "sessions.get", map[string]any{"eventId": it.id}, false)
	if refused != nil {
		return refused
	}
	var stored googlesync.Stored
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatalf("sessions.get result: %v", err)
	}
	d, s := stored.Draft, stored.Session.Session
	if d.ClientID == "" {
		d.ClientID = clientFor(t, w, s.SuggestedClientID)
	}
	switch it.rule {
	case "unconfirmed":
		d.Tentative = false
	case "fee-missing":
		d.FeeCents = cents(rapid.SampledFrom([]int64{9500, 12000}).Draw(t, "fee"))
	case "fee-changed-after-payment":
		if rapid.Bool().Draw(t, "update the payment instead?") {
			d.UpdatePayment = true
		} else {
			// Back to what was paid.
			d.FeeCents = cents(s.Payment.AmountCents)
		}
	case "price-changed-after-payment":
		if p := w.Store.PackageMap[it.id]; d.Package != nil && p.Payment != nil {
			if rapid.Bool().Draw(t, "update the payment instead?") {
				d.UpdatePayment = true
			} else {
				d.Package.PriceCents = p.Payment.AmountCents
			}
		}
	}
	payload := with(asMap(t, d), map[string]any{"eventId": it.id})
	if w.preview(t, "sessions.impact", payload).NeedsFee {
		// The form asks for the fee.
		payload["feeCents"] = rapid.SampledFrom([]int64{9500, 12000}).Draw(t, "fee asked for")
	}
	_, refused = w.Previewed(t, "sessions.impact", payload, "sessions.update", payload, true, true)
	if refused != nil && strings.Contains(refused.Message, "can't be written in a calendar title") {
		// That client's name can't go in a title: she picks another.
		for _, id := range slices.Sorted(maps.Keys(w.Store.ClientMap)) {
			if id != payload["clientId"] && !strings.ContainsAny(w.Store.ClientMap[id].Name, "0123456789") {
				payload["clientId"] = id
				_, refused = w.Previewed(t, "sessions.impact", payload, "sessions.update", payload, true, true)
				break
			}
		}
	}
	return refused
}

// confirms draws whether she confirms what a form's preview shows: mostly.
func confirms(t *rapid.T) bool {
	return rapid.IntRange(0, 3).Draw(t, "confirms?") > 0
}

// fixClient saves a client from the client's form: the unmatched name as
// another of a client's calendar names (the link-client dialog), or a fee.
func fixClient(t *rapid.T, w *World, it todoItem) *router.ErrorBody {
	var name, suggested, clientID string
	switch it.kind {
	case "session":
		s := w.Store.SessionMap[it.id]
		name, suggested, clientID = s.Name, s.SuggestedClientID, s.ClientID
	case "follow-up":
		f := w.Store.FollowUpMap[it.id]
		name, suggested, clientID = f.Name, f.SuggestedClientID, f.ClientID
	}
	var in map[string]any
	if it.rule == "fee-missing" {
		in = profileOf(w.Store.ClientMap[clientID])
		in["feeRates"] = []clients.FeeRate{{Cents: rapid.SampledFrom([]int64{9000, 15000}).Draw(t, "usual fee")}}
	} else {
		c := w.Store.ClientMap[clientFor(t, w, suggested)]
		in = profileOf(c)
		in["aliases"] = append(slices.Clone(c.Aliases), name)
	}
	_, refused := w.Previewed(t, "clients.impact", in, "clients.save", in, true, false)
	return refused
}

// buyPackage records a package bought before the session, whose credit
// then covers it.
func buyPackage(t *rapid.T, w *World, it todoItem) *router.ErrorBody {
	s := w.Store.SessionMap[it.id]
	in := map[string]any{"clientId": s.ClientID, "sessions": 5, "priceCents": 40000, "purchasedAt": s.Start.Add(-time.Hour)}
	_, refused := w.Previewed(t, "packages.impact", in, "packages.save", in, true, false)
	return refused
}

// deletePackage deletes it from its to-do item once she has seen what that
// brings on, giving its client a usual fee when the form asks for one.
func deletePackage(t *rapid.T, w *World, it todoItem) *router.ErrorBody {
	in := map[string]any{"id": it.id}
	preview := with(in, map[string]any{"delete": true})
	if rapid.Bool().Draw(t, "give the client a usual fee?") {
		fee := rapid.SampledFrom([]int64{9000, 15000}).Draw(t, "usual fee")
		in["clientFeeCents"], preview["clientFeeCents"] = fee, fee
	}
	_, refused := w.Previewed(t, "packages.impact", preview, "packages.delete", in, true, true)
	return refused
}

func makeStandalone(t *rapid.T, w *World, it todoItem) *router.ErrorBody {
	_, refused := w.Call(t, "packages.makeStandalone", map[string]any{"id": it.id}, true)
	return refused
}

// settle records or undoes a payment, as the item calls for: collect what
// is owed, pay again (or undo) at an amount that changed, or undo a payment
// that keeps a deleted session or package from going.
func settle(t *rapid.T, w *World, it todoItem) *router.ErrorBody {
	var items []map[string]any
	undo := false
	switch {
	case it.rule == "deleted":
		if !w.Store.SessionMap[it.id].Payment.IsPaid() {
			return skipped
		}
		items, undo = append(items, map[string]any{"kind": "session", "id": it.id}), true
	case it.rule == "purchase-gone":
		if !w.Store.PackageMap[it.id].Payment.IsPaid() {
			return skipped
		}
		items, undo = append(items, map[string]any{"kind": "package", "id": it.id}), true
	case it.kind == "package":
		items = append(items, map[string]any{"kind": "package", "id": it.id})
	case it.rule == "fee-changed-after-payment":
		items = append(items, map[string]any{"kind": "session", "id": it.id})
	default:
		// The Paid menu: what the session owes, its fee, the package bought
		// in it, or both.
		v := w.Store.SessionMap[it.id].View(w.Now)
		if v.OwedCents > v.BoughtOwedCents {
			items = append(items, map[string]any{"kind": "session", "id": it.id})
		}
		if v.BoughtOwedCents > 0 {
			items = append(items, map[string]any{"kind": "package", "id": it.id})
		}
	}
	in := map[string]any{"items": items}
	if !undo {
		in["payment"] = paymentInput(t)
	}
	_, refused := w.Call(t, "payments.set", in, true)
	if refused != nil && strings.HasSuffix(it.rule, "-changed-after-payment") {
		// Nothing left to pay at the new amount: undo the payment instead.
		if _, undone := w.Call(t, "payments.set", map[string]any{"items": items}, true); undone == nil {
			return nil
		}
	}
	return refused
}

// reviseDocuments revises each issued document the item holds and issues
// it again, until the rule clears: its lines follow the calendar by then.
// A revision already open is continued.
func reviseDocuments(t *rapid.T, w *World, it todoItem) *router.ErrorBody {
	refused := skipped
	for _, ref := range w.refs(it, func(r *docref.Ref) bool { return r.Issued() }) {
		if !w.holds(it) {
			break
		}
		d := w.Docs.Docs[ref.DocumentID]
		if d.Draft == nil {
			var data json.RawMessage
			if data, refused = w.Call(t, "documents.revise", map[string]any{"id": d.ID, "version": d.Version}, false); refused != nil {
				continue
			}
			if err := json.Unmarshal(data, &d); err != nil {
				t.Fatalf("documents.revise result: %v", err)
			}
		}
		_, refused = w.Call(t, "documents.issue", map[string]any{"id": d.ID, "version": d.Version}, true)
	}
	return refused
}

// cancelDocuments cancels each issued document the item holds until the
// rule clears.
func cancelDocuments(t *rapid.T, w *World, it todoItem) *router.ErrorBody {
	refused := skipped
	for _, ref := range w.refs(it, func(r *docref.Ref) bool { return r.Issued() }) {
		if !w.holds(it) {
			break
		}
		d := w.Docs.Docs[ref.DocumentID]
		_, refused = w.Call(t, "documents.cancel", map[string]any{"id": d.ID, "version": d.Version, "reason": "The calendar changed"}, false)
	}
	return refused
}

// discardDrafts throws away the drafts the item holds, never issued.
func discardDrafts(t *rapid.T, w *World, it todoItem) *router.ErrorBody {
	refused := skipped
	for _, ref := range w.refs(it, func(r *docref.Ref) bool { return !r.Issued() }) {
		d := w.Docs.Docs[ref.DocumentID]
		_, refused = w.Call(t, "documents.discardDraft", map[string]any{"id": d.ID, "version": d.Version}, false)
	}
	return refused
}

// fixFollowUp edits the follow-up in the app, choosing its client.
func fixFollowUp(t *rapid.T, w *World, it todoItem) *router.ErrorBody {
	f := w.Store.FollowUpMap[it.id]
	in := map[string]any{
		"eventId":  f.EventID,
		"clientId": cmp.Or(f.ClientID, clientFor(t, w, f.SuggestedClientID)),
		"summary":  f.Summary,
		"notes":    f.Notes,
	}
	if f.AllDay {
		in["date"] = f.Due.In(kl).Format(time.DateOnly)
	} else {
		in["start"] = f.Due
	}
	_, refused := w.Call(t, "followUps.update", in, true)
	return refused
}

// refs are the documents a session or package holds that keep accepts: a
// session's own, then those of the package its title bought, which lock
// its booking too.
func (w *World) refs(it todoItem, keep func(*docref.Ref) bool) []*docref.Ref {
	var out []*docref.Ref
	add := func(ref *docref.Ref) {
		if ref != nil && keep(ref) {
			if _, ok := w.Docs.Docs[ref.DocumentID]; ok {
				out = append(out, ref)
			}
		}
	}
	for _, slot := range docref.Slots {
		if it.kind == "package" {
			add(w.Store.PackageMap[it.id].Ref(slot))
		} else {
			add(w.Store.SessionMap[it.id].Ref(slot))
		}
	}
	if p, bought := w.Store.PackageMap[it.id]; it.kind == "session" && bought {
		for _, slot := range docref.Slots {
			add(p.Ref(slot))
		}
	}
	return out
}

// clientFor is the client she picks: usually the suggested one, else any.
func clientFor(t *rapid.T, w *World, suggested string) string {
	if _, ok := w.Store.ClientMap[suggested]; ok && rapid.IntRange(0, 3).Draw(t, "the suggested client?") > 0 {
		return suggested
	}
	return pickClientID(t, w)
}

// profileOf is a client as the client's form saves it.
func profileOf(c clients.Client) map[string]any {
	in := map[string]any{"id": c.ID, "name": c.Name, "aliases": c.Aliases, "feeRates": c.FeeRates, "homeVisits": c.HomeVisits}
	if c.Contact != nil {
		in["contact"] = map[string]any{"resourceName": c.Contact.ResourceName}
	}
	return in
}

// asMap is a value as the JSON object the app would send.
func asMap(t *rapid.T, v any) map[string]any {
	var out map[string]any
	b, err := json.Marshal(v)
	if err == nil {
		err = json.Unmarshal(b, &out)
	}
	if err != nil {
		t.Fatalf("as map: %v", err)
	}
	return out
}

// Recovery counts, for -sim.report and -sim.coverage, what each attempt to
// clear a rule did.
type Recovery struct {
	mu     sync.Mutex
	counts map[string]map[string]int
}

var recoveries Recovery

func (r *Recovery) add(it todoItem, outcome string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.counts == nil {
		r.counts = map[string]map[string]int{}
	}
	key := it.kind + " " + it.rule
	if r.counts[key] == nil {
		r.counts[key] = map[string]int{}
	}
	r.counts[key][outcome]++
}

// uncovered are the fixes every to-do rule lists that never cleared it, or
// cleared the way for another: a rule the runs never reached, or a fix they
// never took, looks just like one that works.
func (r *Recovery) uncovered(rules []todoItem) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []string
	for _, it := range rules {
		for _, action := range it.resolvedBy {
			counts := r.counts[it.kind+" "+it.rule]
			if counts["cleared by "+action] == 0 && counts["cleared the way: "+action] == 0 {
				out = append(out, fmt.Sprintf("%s %s by %s", it.kind, it.rule, action))
			}
		}
	}
	return out
}

// unreached are the to-do rules no fix ever cleared.
func (r *Recovery) unreached(rules []todoItem) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []string
	for _, it := range rules {
		cleared := false
		for outcome, n := range r.counts[it.kind+" "+it.rule] {
			cleared = cleared || (n > 0 && strings.HasPrefix(outcome, "cleared"))
		}
		if !cleared {
			out = append(out, it.kind+" "+it.rule)
		}
	}
	return out
}

// Markdown renders the attempts by rule, most frequent first.
func (r *Recovery) Markdown() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var b strings.Builder
	b.WriteString("\n# Recovery\n\nWhat each attempt to clear a to-do item did, when the simulation emptied the list at the end of a run. " +
		"A refusal is fine while another item's fix comes first; a round in which no fix is taken fails the run.\n")
	for _, key := range slices.Sorted(maps.Keys(r.counts)) {
		counts := r.counts[key]
		outcomes := slices.SortedFunc(maps.Keys(counts), func(a, b string) int {
			return cmp.Or(cmp.Compare(counts[b], counts[a]), strings.Compare(a, b))
		})
		fmt.Fprintf(&b, "\n## %s\n\n| outcome | times |\n|---|---|\n", key)
		for _, o := range outcomes {
			fmt.Fprintf(&b, "| %s | %d |\n", strings.ReplaceAll(o, "|", "\\|"), counts[o])
		}
	}
	return b.String()
}

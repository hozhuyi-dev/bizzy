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

	"bizzy-lambda/internal/features/book"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/command"
	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/router"
)

// Recovery: whatever state a run leaves, the user can empty the to-do list
// with the app alone. Each item is tried with the actions it offers (its
// rule's ResolvedBy; a conflict's remedies, then its own fixes), in an
// order and with details drawn at random, as the app sends them: so over
// many runs, every way out is taken from many states. A fix may only clear
// the way for another (an invoice cancelled before an edit waiting in the
// calendar can apply), but the list must empty within maxDrainRounds, and
// a round in which no fix is taken means she is stuck.

// maxDrainRounds bounds how many rounds of fixes the list may take to
// empty: each round can unblock the next, but never forever.
const maxDrainRounds = 30

// todoItem is one rule putting an entity on the to-do list, with the
// fixes its item offers.
type todoItem struct {
	kind, id, rule string
	fixes          []command.Remedy
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
	for _, key := range slices.Sorted(maps.Keys(w.Store.ConflictMap)) {
		v := w.Store.ConflictMap[key].View()
		for _, rule := range v.Rules {
			out = append(out, todoItem{kind: "conflict", id: key, rule: rule, fixes: v.Fixes})
		}
	}
	return out
}

func firing[S any](kind, id string, rules statemodel.Rules[S], s S) []todoItem {
	var out []todoItem
	for _, r := range rules.Evaluate(s).Fired {
		if r.Bucket == statemodel.Impossible {
			continue
		}
		it := todoItem{kind: kind, id: id, rule: r.ID}
		for _, action := range r.ResolvedBy {
			it.fixes = append(it.fixes, command.Remedy{Action: action, Target: id})
		}
		out = append(out, it)
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
	case "conflict":
		c, ok := w.Store.ConflictMap[it.id]
		return ok && ruleHolds(conflicts.Rules, it.rule, c.State())
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
	order := rapid.Permutation(it.fixes).Draw(t, "fixes for "+it.rule)
	for _, fix := range order {
		try, known := resolvers[fix.Action]
		if !known {
			t.Fatalf("recovery: no way to try %s for %s; add one to resolvers", fix.Action, it)
		}
		before, held := w.snapshot(), w.contradictions()
		refused := try(t, w, it, fix.Target)
		changed := !w.snapshot().equal(before)
		var outcome string
		switch {
		case refused != nil && refused.Code == skip:
			continue
		case refused != nil:
			outcome = fmt.Sprintf("%s refused: %s", fix.Action, refused.Message)
		case !changed:
			outcome = fix.Action + " changed nothing"
		case w.holds(it):
			outcome = "cleared the way: " + fix.Action
		default:
			outcome = "cleared by " + fix.Action
		}
		recoveries.add(it, outcome)
		tried = append(tried, outcome)
		noNewContradictions(t, fix.Action, held, w.contradictions())
		check(t, w)
		if refused == nil && changed {
			return tried, true
		}
	}
	return tried, false
}

// A resolver does what the app does when the user takes that action on an
// item (its target: what the fix is for), and returns the refusal if the
// API refused. One that doesn't apply returns skip, sending nothing.
type resolver func(t *rapid.T, w *World, it todoItem, target string) *router.ErrorBody

// skip is the code of a fix that doesn't apply to the item.
const skip = "skip"

var skipped = &router.ErrorBody{Code: skip}

// call sends an action and returns its refusal, if any.
func call(t *rapid.T, w *World, action string, payload any) *router.ErrorBody {
	_, refused := w.Call(t, action, payload, true)
	return refused
}

// resolvers covers every action a to-do item can offer (see the catalogue
// test).
var resolvers = map[string]resolver{
	// Cancel, beside Confirm on the to-do list; Delete it with its notes,
	// on a conflict.
	"sessions.delete": func(t *rapid.T, w *World, _ todoItem, id string) *router.ErrorBody {
		return call(t, w, "sessions.delete", map[string]any{"id": id, "keepPackage": true})
	},
	// The summary line on the to-do list.
	"sessions.saveRecord": func(t *rapid.T, w *World, _ todoItem, id string) *router.ErrorBody {
		summary := rapid.SampledFrom([]string{"Seen", "Knee review"}).Draw(t, "summary")
		return call(t, w, "sessions.saveRecord", map[string]any{"id": id, "summary": summary})
	},
	"sessions.update":         fixBooking,
	"payments.set":            settle,
	"clients.save":            fixClient,
	"packages.save":           buyPackage,
	"packages.makeStandalone": onID("packages.makeStandalone"),
	"documents.cancel": func(t *rapid.T, w *World, _ todoItem, id string) *router.ErrorBody {
		d, ok := w.Store.Docs[id]
		if !ok {
			return skipped
		}
		return call(t, w, "documents.cancel", map[string]any{"id": id, "version": d.Version, "reason": "To change it"})
	},
	"calendar.revert": onKey("calendar.revert"),
	"conflicts.apply": onKey("conflicts.apply"),
	"calendar.ignore": onKey("calendar.ignore"),
	"followUps.setDone": func(t *rapid.T, w *World, _ todoItem, id string) *router.ErrorBody {
		return call(t, w, "followUps.setDone", map[string]any{"id": id, "done": true})
	},
	"followUps.delete": onID("followUps.delete"),
}

func onID(action string) resolver {
	return func(t *rapid.T, w *World, _ todoItem, id string) *router.ErrorBody {
		return call(t, w, action, map[string]any{"id": id})
	}
}

func onKey(action string) resolver {
	return func(t *rapid.T, w *World, _ todoItem, key string) *router.ErrorBody {
		return call(t, w, action, map[string]any{"key": key})
	}
}

// fixBooking edits the session in the app, starting from the form's draft
// (as the session page does): confirmed, and sometimes with its own fee,
// which frees a package credit; what was paid follows the change.
func fixBooking(t *rapid.T, w *World, _ todoItem, id string) *router.ErrorBody {
	data, refused := w.Call(t, "sessions.get", map[string]any{"id": id}, false)
	if refused != nil {
		return refused
	}
	var stored book.Stored
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatalf("sessions.get result: %v", err)
	}
	d := stored.Draft
	d.Tentative = false
	if rapid.IntRange(0, 3).Draw(t, "move it?") == 0 {
		// Out of another session's way.
		d.Start = d.Start.Add(time.Duration(rapid.SampledFrom([]int{-30, 7, 30}).Draw(t, "days moved")) * 24 * time.Hour)
	}
	if d.FeeCents == nil && rapid.Bool().Draw(t, "enter a fee?") {
		d.FeeCents = cents(rapid.SampledFrom([]int64{9500, 12000}).Draw(t, "fee"))
	}
	payload := with(asMap(t, d), map[string]any{"id": id, "updatePayment": true})
	return call(t, w, "sessions.update", payload)
}

// settle records what is owed on the item, or undoes a payment when the
// fix names one ("session:<id>").
func settle(t *rapid.T, w *World, it todoItem, target string) *router.ErrorBody {
	if kind, id, ok := strings.Cut(target, ":"); ok {
		return call(t, w, "payments.set", map[string]any{"items": []map[string]any{{"kind": kind, "id": id}}})
	}
	var items []map[string]any
	switch it.kind {
	case "package":
		items = append(items, map[string]any{"kind": "package", "id": target})
	default:
		// The Paid menu: what the session owes, its fee, the package bought
		// in it, or both.
		s := w.Store.SessionMap[target]
		if s.OwedCents() > 0 {
			items = append(items, map[string]any{"kind": "session", "id": target})
		}
		if s.BoughtOwedCents > 0 {
			items = append(items, map[string]any{"kind": "package", "id": s.BoughtPackageID})
		}
	}
	if len(items) == 0 {
		return skipped
	}
	return call(t, w, "payments.set", map[string]any{"items": items, "payment": paymentInput(t)})
}

// fixClient saves a client from the client's form, as the item's fix asks:
// the calendar's name as one of a client's names, a new client of that
// name, a usual fee, or a name a title can say.
func fixClient(t *rapid.T, w *World, it todoItem, clientID string) *router.ErrorBody {
	conflict, ok := w.Store.ConflictMap[it.id]
	if !ok {
		return skipped
	}
	var guard string
	for _, v := range conflict.Violations {
		if slices.ContainsFunc(v.Remedies, func(r command.Remedy) bool { return r.Action == "clients.save" && r.Target == clientID }) {
			guard = v.Guard
			break
		}
	}
	c, known := w.Store.ClientMap[clientID]
	switch guard {
	case "name-is-a-client":
		name := titleName(conflict)
		if !known {
			in := map[string]any{"name": name, "feeRates": []clients.FeeRate{{Cents: 9000}}}
			if len(w.Contacts.People) > 0 {
				in["contact"] = map[string]any{"resourceName": w.Contacts.People[0].ResourceName}
			}
			return call(t, w, "clients.save", in)
		}
		in := profileOf(c)
		in["aliases"] = append(slices.Clone(c.Aliases), name)
		return call(t, w, "clients.save", in)
	case "fee-known":
		in := profileOf(c)
		in["feeRates"] = []clients.FeeRate{{Cents: rapid.SampledFrom([]int64{9000, 15000}).Draw(t, "usual fee")}}
		return call(t, w, "clients.save", in)
	case "name-can-be-written":
		in := profileOf(c)
		in["name"] = strings.TrimRight(c.Name, " 0123456789") + " Junior"
		return call(t, w, "clients.save", in)
	}
	return skipped
}

// titleName is the name the event's title says.
func titleName(c conflicts.Conflict) string {
	if c.Now == nil {
		return ""
	}
	if calendar.IsFollowUp(c.Now.Title) {
		title, _ := calendar.ParseFollowUp(c.Now.Title)
		return title.Name
	}
	title, _ := calendar.ParseTitle(c.Now.Title)
	return title.Name
}

// buyPackage records a package bought before the session the conflict is
// about, whose credit then covers it.
func buyPackage(t *rapid.T, w *World, it todoItem, clientID string) *router.ErrorBody {
	conflict, ok := w.Store.ConflictMap[it.id]
	if !ok || conflict.Now == nil {
		return skipped
	}
	in := map[string]any{"clientId": clientID, "sessions": 5, "priceCents": 40000, "purchasedAt": conflict.Now.Start.Add(-time.Hour)}
	return call(t, w, "packages.save", in)
}

// profileOf is a client as the client's form saves it.
func profileOf(c clients.Client) map[string]any {
	in := map[string]any{"id": c.ID, "name": c.Name, "aliases": slices.Clone(c.Aliases), "feeRates": c.FeeRates, "homeVisits": c.HomeVisits}
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
		for _, fix := range it.fixes {
			action := fix.Action
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

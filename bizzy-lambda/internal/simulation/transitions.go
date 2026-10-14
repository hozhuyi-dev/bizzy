package simulation

import (
	"cmp"
	"fmt"
	"maps"
	"slices"
	"strings"
	"sync"

	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/statemodel"
)

// Transitions counts, for each action, how it moved entities between rule
// states: which rules held before and after. It answers "which action takes
// a session from unpaid to quiet", from what the simulation observed.
type Transitions struct {
	mu     sync.Mutex
	counts map[string]map[transition]int
}

type transition struct{ kind, from, to string }

const (
	absent  = "(none)"
	removed = "(deleted)"
)

// ruleStates are the rules that hold for each session, package, follow-up
// and conflict, keyed "<kind> <id>"; "quiet" when none does.
func (w *World) ruleStates() map[string]string {
	out := map[string]string{}
	for id, s := range w.Store.SessionMap {
		out["session "+id] = fired(sessions.Rules, s.State(w.Now))
	}
	for id, p := range w.Store.PackageMap {
		out["package "+id] = fired(packages.Rules, p.State(w.Now))
	}
	for id, f := range w.Store.FollowUpMap {
		out["follow-up "+id] = fired(followups.Rules, f.State())
	}
	for key, c := range w.Store.ConflictMap {
		out["conflict "+key] = fired(conflicts.Rules, c.State())
	}
	return out
}

func fired[S any](rules statemodel.Rules[S], s S) string {
	var ids []string
	for _, r := range rules.Evaluate(s).Fired {
		ids = append(ids, r.ID)
	}
	if len(ids) == 0 {
		return string(statemodel.Quiet)
	}
	return strings.Join(ids, ", ")
}

// record counts what an action changed.
func (tr *Transitions) record(action string, before, after map[string]string) {
	tr.mu.Lock()
	defer tr.mu.Unlock()
	if tr.counts == nil {
		tr.counts = map[string]map[transition]int{}
	}
	for _, key := range slices.Sorted(maps.Keys(after)) {
		from, ok := before[key]
		if !ok {
			from = absent
		}
		tr.add(action, key, from, after[key])
	}
	for key, from := range before {
		if _, ok := after[key]; !ok {
			tr.add(action, key, from, removed)
		}
	}
}

func (tr *Transitions) add(action, key, from, to string) {
	if from == to {
		return
	}
	kind, _, _ := strings.Cut(key, " ")
	if tr.counts[action] == nil {
		tr.counts[action] = map[transition]int{}
	}
	tr.counts[action][transition{kind, from, to}]++
}

// Markdown renders the transitions by action, most frequent first.
func (tr *Transitions) Markdown() string {
	tr.mu.Lock()
	defer tr.mu.Unlock()
	var b strings.Builder
	b.WriteString("# Observed transitions\n\n")
	b.WriteString("What each action did to the rules that hold for sessions, packages and follow-ups, " +
		"counted over the simulation's runs (`go test ./internal/simulation -run TestSimulation -sim.report=transitions.md`). " +
		"A rule state is the rules that hold, in priority order; quiet is none.\n")
	for _, action := range slices.Sorted(maps.Keys(tr.counts)) {
		counts := tr.counts[action]
		keys := slices.SortedFunc(maps.Keys(counts), func(a, b transition) int {
			return cmp.Or(cmp.Compare(a.kind, b.kind), cmp.Compare(counts[b], counts[a]), cmp.Compare(a.from, b.from), cmp.Compare(a.to, b.to))
		})
		fmt.Fprintf(&b, "\n## %s\n\n| entity | from | to | times |\n|---|---|---|---|\n", action)
		for _, k := range keys {
			fmt.Fprintf(&b, "| %s | %s | %s | %d |\n", k.kind, k.from, k.to, counts[k])
		}
	}
	return b.String()
}

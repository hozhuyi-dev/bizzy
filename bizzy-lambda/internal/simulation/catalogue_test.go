package simulation

import (
	"slices"
	"testing"

	"bizzy-lambda/internal/features/book"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/integrity"
	"bizzy-lambda/internal/platform/command"
	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/router"
)

// TestCatalogueCoversEveryMutation fails when a mutation is added to the
// router without an action here, or a rule names an action that doesn't
// exist: each new feature has to say how the simulation exercises it.
func TestCatalogueCoversEveryMutation(t *testing.T) {
	w := newWorld(t)
	mutations := w.App.Router.Actions(router.KindMutation)

	seen := map[string]bool{}
	for _, a := range Catalogue() {
		if seen[a.Name] {
			t.Errorf("action %s is in the catalogue twice", a.Name)
		}
		seen[a.Name] = true
		if a.Actor == ActorUser && !slices.Contains(mutations, a.Name) {
			t.Errorf("user action %s is not a router mutation", a.Name)
		}
	}
	for _, m := range mutations {
		if !seen[m] {
			t.Errorf("mutation %s has no action in the simulation: add one to actions_user.go", m)
		}
	}
	for _, a := range integrity.Actions() {
		if !slices.Contains(mutations, a) {
			t.Errorf("a rule names %s, which is not a router mutation", a)
		}
	}
	for _, it := range resolvable() {
		for _, fix := range it.fixes {
			if _, ok := resolvers[fix.Action]; !ok {
				t.Errorf("rule %s is resolved by %s, which recovery.go can't try: add it to resolvers", it.rule, fix.Action)
			}
		}
	}
	// A conflict offers its guards' remedies.
	for _, g := range book.Guards {
		for _, a := range g.Remedies {
			if _, ok := resolvers[a]; !ok {
				t.Errorf("guard %s offers %s, which recovery.go can't try: add it to resolvers", g.ID, a)
			}
		}
	}
}

// resolvable are the to-do rules of every entity, as items.
func resolvable() []todoItem {
	var out []todoItem
	add := func(rules []todoItem) { out = append(out, rules...) }
	add(ruleItems("session", sessions.Rules))
	add(ruleItems("package", packages.Rules))
	add(ruleItems("follow-up", followups.Rules))
	add(ruleItems("conflict", conflicts.Rules))
	return out
}

func ruleItems[S any](kind string, rules statemodel.Rules[S]) []todoItem {
	var out []todoItem
	for _, r := range rules {
		if r.Bucket != statemodel.Impossible {
			it := todoItem{kind: kind, rule: r.ID}
			for _, a := range r.ResolvedBy {
				it.fixes = append(it.fixes, command.Remedy{Action: a})
			}
			out = append(out, it)
		}
	}
	return out
}

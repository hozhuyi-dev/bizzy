package simulation

import (
	"slices"
	"testing"

	"bizzy-lambda/internal/integrity"
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
}

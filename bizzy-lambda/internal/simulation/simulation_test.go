package simulation

import (
	"flag"
	"os"
	"slices"
	"testing"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/testutil/testapp"
)

func TestMain(m *testing.M) {
	flag.Parse()
	// rapid's default of 30 steps rarely gets far enough to swap two
	// sessions in the calendar after a client is renamed.
	set := false
	flag.Visit(func(f *flag.Flag) { set = set || f.Name == "rapid.steps" })
	if !set {
		_ = flag.Set("rapid.steps", "100")
	}
	os.Exit(m.Run())
}

// TestSimulation runs random sequences of actions from every actor and
// checks the world after each one (see checks.go).
func TestSimulation(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := newWorld(t)
		actions := map[string]func(*rapid.T){
			"": func(t *rapid.T) { check(t, w) },
		}
		for _, a := range Catalogue() {
			actions[a.Name] = func(t *rapid.T) {
				appOnly := a.Actor == ActorUser && !a.Syncs
				var before map[string]bool
				if appOnly {
					before = conflictIDs(t, w)
				}
				a.Run(t, w)
				if appOnly {
					noNewConflicts(t, a.Name, before, conflictIDs(t, w))
				}
			}
		}
		t.Repeat(actions)
	})
}

// TestCatalogueCoversEveryMutation fails when a mutation is added to the
// router without an action here: each feature has to say how the
// simulation exercises it.
func TestCatalogueCoversEveryMutation(t *testing.T) {
	mutations := testapp.New().Router.Actions("mutation")
	var users []string
	for _, a := range Catalogue() {
		if a.Actor == ActorUser {
			users = append(users, a.Name)
			if !slices.Contains(mutations, a.Name) {
				t.Errorf("user action %s is no router mutation", a.Name)
			}
		}
	}
	for _, m := range mutations {
		if !slices.Contains(users, m) {
			t.Errorf("mutation %s has no action in the simulation: add one to actions_user.go", m)
		}
	}
}

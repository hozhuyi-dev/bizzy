package simulation

import (
	"flag"
	"fmt"
	"os"
	"testing"

	"pgregory.net/rapid"
)

// defaultSteps is how many actions a run averages unless -rapid.steps says
// otherwise: rapid's 30 rarely reaches a receipt being cancelled after a
// calendar edit.
const defaultSteps = "100"

var report = flag.String("sim.report", "", "write the transitions the simulation observed to this Markdown file")

// observed collects the transitions of every run, for -sim.report.
var observed Transitions

func TestMain(m *testing.M) {
	flag.Parse()
	set := false
	flag.Visit(func(f *flag.Flag) { set = set || f.Name == "rapid.steps" })
	if !set {
		_ = flag.Set("rapid.steps", defaultSteps)
	}
	code := m.Run()
	if *report != "" {
		if err := os.WriteFile(*report, []byte(observed.Markdown()+recoveries.Markdown()), 0o644); err != nil {
			fmt.Fprintln(os.Stderr, err)
			code = 1
		}
	}
	os.Exit(code)
}

// TestSimulation runs random sequences of actions from every actor and
// checks the world after each one (see checks.go), then that the user can
// empty the to-do list from wherever the run left it (see recovery.go).
func TestSimulation(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		w := newWorld(t)
		actions := map[string]func(*rapid.T){
			"": func(t *rapid.T) { check(t, w) },
		}
		for _, a := range Catalogue() {
			actions[a.Name] = func(t *rapid.T) {
				before := w.ruleStates()
				var held map[string][]string
				var stale map[string]bool
				exact := w.InSync && !w.unhealed
				if (a.Actor == ActorUser || a.Actor == ActorScenario) && !a.Reveals {
					held, stale = w.settled(t)
				}
				w.allowed = nil
				a.Run(t, w)
				observed.record(a.Name, before, w.ruleStates())
				if held != nil {
					after, _ := w.settled(t)
					noNewContradictions(t, a.Name, held, after, w.allowed, exact, stale)
				}
				w.allowed = nil
			}
		}
		t.Repeat(actions)
		everyToDoCanBeCleared(t, w)
	})
	if *coverage {
		for _, missing := range recoveries.unreached(resolvable()) {
			t.Errorf("no run cleared %s: run longer, or make the generators reach it", missing)
		}
		for _, missing := range recoveries.uncovered(resolvable()) {
			t.Logf("no run cleared %s (rare pairs are only listed)", missing)
		}
	}
}

var coverage = flag.Bool("sim.coverage", false, "fail unless every to-do rule was cleared in some run, and list fixes never seen clearing theirs (use with many -rapid.checks)")

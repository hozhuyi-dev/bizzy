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
		if err := os.WriteFile(*report, []byte(observed.Markdown()), 0o644); err != nil {
			fmt.Fprintln(os.Stderr, err)
			code = 1
		}
	}
	os.Exit(code)
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
				before := w.ruleStates()
				a.Run(t, w)
				observed.record(a.Name, before, w.ruleStates())
			}
		}
		t.Repeat(actions)
	})
}

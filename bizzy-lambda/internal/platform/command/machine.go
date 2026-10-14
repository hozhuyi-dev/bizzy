package command

import (
	"slices"

	"pgregory.net/rapid"
)

// Machine is a guard table under test, as a pure model: a state, the
// commands that change it, and what no change the guards let through may
// break. It needs no store or API, so rapid runs thousands of sequences a
// second; the simulation checks the same rules end to end, slower.
//
// Check is the property: whatever is drawn, a command the guards take
// breaks nothing, and a refusal offers only the remedies its guard lists.
// Unneeded turns each guard off in turn and looks for a run that then
// breaks something: a guard no run needs protects nothing the model can
// reach, or another guard already keeps it.
type Machine[S any] struct {
	// Start is a fresh state.
	Start func() S
	// Draw draws a command for the state; nil when none fits.
	Draw func(t *rapid.T, s S) Command
	// Decide decides a command with every guard but off ("" for none): the
	// state after it, and the refusals. An error is input that makes no
	// sense, which changes nothing.
	Decide func(s S, cmd Command, off string) (S, []Violation, error)
	// Broken lists what a change breaks, judged from both sides of it.
	Broken func(before, after S, cmd Command) []string
	// Offers are the remedy actions each guard may offer, by guard ID.
	Offers map[string][]string
	// Steps is how many commands a run draws.
	Steps int
}

// Check runs one drawn sequence of commands (see Machine).
func (m Machine[S]) Check(t *rapid.T) {
	s := m.Start()
	for step := range m.Steps {
		cmd := m.Draw(t, s)
		if cmd == nil {
			continue
		}
		after, violations, err := m.Decide(s, cmd, "")
		if err != nil {
			t.Logf("step %d: %s: %v", step, cmd.Action(), err)
			continue
		}
		for _, v := range violations {
			for _, r := range v.Remedies {
				if !slices.Contains(m.Offers[v.Guard], r.Action) {
					t.Fatalf("step %d: %s: %s offered %s, which it doesn't list", step, cmd.Action(), v.Guard, r.Action)
				}
			}
		}
		if len(violations) > 0 {
			t.Logf("step %d: %s refused by %s", step, cmd.Action(), violations[0].Guard)
			continue
		}
		if broken := m.Broken(s, after, cmd); len(broken) > 0 {
			t.Fatalf("step %d: %s %+v broke %v", step, cmd.Action(), cmd, broken)
		}
		t.Logf("step %d: %s", step, cmd.Action())
		s = after
	}
}

// Unneeded are the guards of ids that no run of runs needs: with the
// guard off and every other on, nothing breaks. Each run is drawn from its
// seed, so the answer is the same every time.
func (m Machine[S]) Unneeded(ids []string, runs int) []string {
	var out []string
	for _, id := range ids {
		needed := false
		breaks := rapid.Custom(func(t *rapid.T) bool { return m.breaks(t, id) })
		for seed := 0; seed < runs && !needed; seed++ {
			needed = breaks.Example(seed)
		}
		if !needed {
			out = append(out, id)
		}
	}
	return out
}

// breaks runs a drawn sequence with a guard off: whether some change then
// breaks something.
func (m Machine[S]) breaks(t *rapid.T, off string) bool {
	s := m.Start()
	for range m.Steps {
		cmd := m.Draw(t, s)
		if cmd == nil {
			continue
		}
		after, violations, err := m.Decide(s, cmd, off)
		if err != nil || len(violations) > 0 {
			continue
		}
		if len(m.Broken(s, after, cmd)) > 0 {
			return true
		}
		s = after
	}
	return false
}

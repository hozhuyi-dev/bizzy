package command

import (
	"fmt"
	"slices"
)

// Guard is one row of a guard table: a precondition of the commands it is
// On, and what it says when it refuses.
type Guard[B any] struct {
	// ID names the guard in refusals, conflicts and the table, e.g.
	// "issued-invoice-fixes-the-fee".
	ID string
	// On are the actions it checks (see On).
	On []string
	// Why explains the guard to whoever reads the table.
	Why string
	// Fails says whether it refuses the command against b.
	Fails func(b B, c Command) bool
	// Say is the refusal: the message shown, and the remedies offered. Each
	// remedy's action must be one of Remedies.
	Say func(b B, c Command) (message string, remedies []Remedy)

	// Remedies are the actions Say may offer, for the table.
	Remedies []string
	// Seams are remedies not built yet (credit notes): listed in the table,
	// never offered.
	Seams []string
	// NoRemedy says why a guard offers nothing, e.g. it waits for time to
	// pass. A guard has remedies or says this, so no refusal is a dead end
	// by oversight.
	NoRemedy string

	// Protects names the invariants it keeps from breaking: the Impossible
	// rules and integrity links it guards.
	Protects []string
	// Policy says which business rule it is, when it protects no
	// invariant: "notes are written once the session has started".
	Policy string
}

// Guards is a feature's guard table, in the order its refusals are shown.
type Guards[B any] []Guard[B]

// Decide is every guard that refuses the command against b, in table
// order; nil when the command may be applied.
func (gs Guards[B]) Decide(b B, c Command) []Violation {
	action := c.Action()
	var out []Violation
	for _, g := range gs {
		if !slices.Contains(g.On, action) || !g.Fails(b, c) {
			continue
		}
		message, remedies := g.Say(b, c)
		if remedies == nil {
			remedies = []Remedy{}
		}
		out = append(out, Violation{Guard: g.ID, Message: message, Remedies: remedies})
	}
	return out
}

// Check is Decide as an error: the first refusal, or nil.
func (gs Guards[B]) Check(b B, c Command) error {
	return Err(gs.Decide(b, c))
}

// Find returns the guard with an ID.
func (gs Guards[B]) Find(id string) (Guard[B], bool) {
	i := slices.IndexFunc(gs, func(g Guard[B]) bool { return g.ID == id })
	if i < 0 {
		return Guard[B]{}, false
	}
	return gs[i], true
}

// Actions lists every action the table guards, sorted, each once.
func (gs Guards[B]) Actions() []string {
	var out []string
	for _, g := range gs {
		out = append(out, g.On...)
	}
	slices.Sort(out)
	return slices.Compact(out)
}

// Offered checks a refusal against its guard's row: the remedies it offers
// are ones the row declares, and it offers one unless the row says why
// not. Property tests run it on every refusal they see.
func (gs Guards[B]) Offered(v Violation) error {
	g, ok := gs.Find(v.Guard)
	if !ok {
		return fmt.Errorf("%s: no such guard", v.Guard)
	}
	if len(v.Remedies) == 0 && g.NoRemedy == "" {
		return fmt.Errorf("%s refused with no remedy (%q), and its row doesn't say why", g.ID, v.Message)
	}
	for _, r := range v.Remedies {
		if !slices.Contains(g.Remedies, r.Action) {
			return fmt.Errorf("%s offered %s, which its row doesn't declare", g.ID, r.Action)
		}
	}
	return nil
}

// Lint reports what is wrong with the table itself. invariants are the IDs
// a guard may protect (the feature's Impossible rules and integrity links);
// nil skips that check.
func (gs Guards[B]) Lint(invariants []string) []error {
	var errs []error
	seen := map[string]bool{}
	for i, g := range gs {
		name := g.ID
		if name == "" {
			name = fmt.Sprintf("guard %d", i)
			errs = append(errs, fmt.Errorf("%s has no ID", name))
		}
		if seen[g.ID] {
			errs = append(errs, fmt.Errorf("%s appears twice", name))
		}
		seen[g.ID] = true
		switch {
		case len(g.On) == 0:
			errs = append(errs, fmt.Errorf("%s guards no action", name))
		case len(slices.Compact(slices.Sorted(slices.Values(g.On)))) != len(g.On):
			errs = append(errs, fmt.Errorf("%s lists an action twice", name))
		}
		if g.Why == "" {
			errs = append(errs, fmt.Errorf("%s doesn't say why", name))
		}
		if g.Fails == nil || g.Say == nil {
			errs = append(errs, fmt.Errorf("%s needs Fails and Say", name))
		}
		if len(g.Remedies) == 0 && g.NoRemedy == "" {
			errs = append(errs, fmt.Errorf("%s offers no remedy and doesn't say why (NoRemedy)", name))
		}
		if len(g.Remedies) > 0 && g.NoRemedy != "" {
			errs = append(errs, fmt.Errorf("%s has remedies and NoRemedy", name))
		}
		if (len(g.Protects) > 0) == (g.Policy != "") {
			errs = append(errs, fmt.Errorf("%s needs exactly one of Protects (the invariants it keeps) and Policy (the business rule it is)", name))
		}
		if invariants != nil {
			for _, id := range g.Protects {
				if !slices.Contains(invariants, id) {
					errs = append(errs, fmt.Errorf("%s protects %s, which is no invariant", name, id))
				}
			}
		}
	}
	return errs
}

// Unguarded lists the invariants no guard protects, of those that need
// one: an invariant kept by construction alone is left out by the caller.
func (gs Guards[B]) Unguarded(invariants []string) []string {
	var out []string
	for _, id := range invariants {
		if !slices.ContainsFunc(gs, func(g Guard[B]) bool { return slices.Contains(g.Protects, id) }) {
			out = append(out, id)
		}
	}
	return out
}

package statemodel

import "slices"

// Reason is what a to-do item asks of the user, e.g. "record" or "collect".
// The app shows a quick action for each.
type Reason string

// Rule is one row of an entity's rule table: a condition over its State and
// what it means when it holds.
type Rule[S any] struct {
	// ID names the rule in tests and the decision table, e.g.
	// "receipt-without-payment".
	ID     string
	Bucket Bucket
	// Why explains the rule to whoever reads the table.
	Why  string
	When func(S) bool

	// Reason is the to-do reason a NeedsAction or Contradiction rule puts on
	// the list.
	Reason Reason
	// Stop hides the to-do reasons of the rules after it, bar those with the
	// same Reason: there is no point confirming a session no client matches.
	Stop bool
	// ResolvedBy are the actions (router names) that resolve a NeedsAction
	// or Contradiction rule: the quick actions its to-do item offers.
	ResolvedBy []string

	// GuardedBy are the mutations whose guards keep an Impossible rule from
	// happening.
	GuardedBy []string
	// ByConstruction says why an Impossible rule without guards can't
	// happen, e.g. the reconcile derives one field from the other.
	ByConstruction string
}

// Rules is an entity's rule table, in priority order.
type Rules[S any] []Rule[S]

// Outcome is what the rules make of one state.
type Outcome[S any] struct {
	Bucket Bucket
	// Fired are the rules that hold and count, in order: Impossible rules
	// always count; to-do rules after a Stop only with its Reason.
	Fired []Rule[S]
}

// Evaluate applies the rules to a state.
func (rs Rules[S]) Evaluate(s S) Outcome[S] {
	out := Outcome[S]{Bucket: Quiet}
	var stopped *Reason
	for _, r := range rs {
		if r.Bucket != Impossible && stopped != nil && r.Reason != *stopped {
			continue
		}
		if !r.When(s) {
			continue
		}
		out.Fired = append(out.Fired, r)
		out.Bucket = Worse(out.Bucket, r.Bucket)
		if r.Stop && stopped == nil {
			reason := r.Reason
			stopped = &reason
		}
	}
	return out
}

// Reasons are the to-do reasons for a state, in rule order, each once; nil
// when there is nothing to do.
func (rs Rules[S]) Reasons(s S) []Reason {
	var reasons []Reason
	for _, r := range rs.Evaluate(s).Fired {
		if r.Reason != "" && !slices.Contains(reasons, r.Reason) {
			reasons = append(reasons, r.Reason)
		}
	}
	return reasons
}

// Fixes are the actions that resolve the to-do rules a state puts on the
// list, in rule order, each once: the quick actions its to-do item offers.
// Nil when there is nothing to do.
func (rs Rules[S]) Fixes(s S) []string {
	var out []string
	for _, r := range rs.Evaluate(s).Fired {
		for _, a := range r.ResolvedBy {
			if r.Bucket != Impossible && !slices.Contains(out, a) {
				out = append(out, a)
			}
		}
	}
	return out
}

// Violations are the Impossible rules that hold for a state.
func (rs Rules[S]) Violations(s S) []Rule[S] {
	var out []Rule[S]
	for _, r := range rs {
		if r.Bucket == Impossible && r.When(s) {
			out = append(out, r)
		}
	}
	return out
}

// Find returns the rule with an ID.
func (rs Rules[S]) Find(id string) (Rule[S], bool) {
	i := slices.IndexFunc(rs, func(r Rule[S]) bool { return r.ID == id })
	if i < 0 {
		return Rule[S]{}, false
	}
	return rs[i], true
}

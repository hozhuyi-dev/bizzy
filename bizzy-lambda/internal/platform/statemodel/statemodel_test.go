package statemodel

import (
	"slices"
	"strings"
	"testing"
)

type light string
type paid string

const (
	on  light = "on"
	off light = "off"

	yes paid = "yes"
	no  paid = "no"
)

type toy struct {
	Light light
	Paid  paid
}

var toyAxes = Axes[toy]{
	NewAxis("light", []light{on, off}, func(s *toy, v light) { s.Light = v }),
	NewAxis("paid", []paid{yes, no}, func(s *toy, v paid) { s.Paid = v }),
}

var toyRules = Rules[toy]{
	{ID: "off", Bucket: Contradiction, Reason: "fix", Stop: true, ResolvedBy: []string{"toy.fix"},
		When: func(s toy) bool { return s.Light == off }},
	{ID: "unpaid", Bucket: NeedsAction, Reason: "collect", ResolvedBy: []string{"toy.pay"},
		When: func(s toy) bool { return s.Paid == no }},
	{ID: "never", Bucket: Impossible, GuardedBy: []string{"toy.pay"},
		When: func(s toy) bool { return s.Light == off && s.Paid == yes }},
}

func TestStopHidesLaterReasonsButNotImpossible(t *testing.T) {
	out := toyRules.Evaluate(toy{Light: off, Paid: yes})
	var ids []string
	for _, r := range out.Fired {
		ids = append(ids, r.ID)
	}
	if !slices.Equal(ids, []string{"off", "never"}) || out.Bucket != Impossible {
		t.Errorf("fired %v bucket %s, want off and never, impossible", ids, out.Bucket)
	}
	if got := toyRules.Reasons(toy{Light: off, Paid: no}); !slices.Equal(got, []Reason{"fix"}) {
		t.Errorf("reasons = %v, want fix alone", got)
	}
	if got := toyRules.Reasons(toy{Light: on, Paid: yes}); got != nil {
		t.Errorf("reasons = %v, want none", got)
	}
}

func TestTableMergesAxesThatDontMatter(t *testing.T) {
	quiet := Rules[toy]{{ID: "unpaid", Bucket: NeedsAction, Reason: "collect", ResolvedBy: []string{"toy.pay"},
		When: func(s toy) bool { return s.Paid == no }}}
	table := Table("Toy", toyAxes, quiet)
	if !strings.Contains(table, "| * | no | needs-action | collect | unpaid |") ||
		!strings.Contains(table, "| * | yes | quiet |  |  |") ||
		!strings.Contains(table, "shown as 2 rows") {
		t.Errorf("light makes no difference, so it should be *:\n%s", table)
	}
}

func TestLint(t *testing.T) {
	if errs := Lint(toyAxes, toyRules); len(errs) != 0 {
		t.Errorf("lint = %v, want none", errs)
	}
	bad := Rules[toy]{
		{ID: "dead", Bucket: NeedsAction, Reason: "x", ResolvedBy: []string{"a"}, When: func(toy) bool { return false }},
		{ID: "unguarded", Bucket: Impossible, When: func(toy) bool { return true }},
		{ID: "unresolved", Bucket: NeedsAction, When: func(toy) bool { return true }},
	}
	if errs := Lint(toyAxes, bad); len(errs) != 3 {
		t.Errorf("lint = %v, want the dead, unguarded and unresolved rules", errs)
	}
}

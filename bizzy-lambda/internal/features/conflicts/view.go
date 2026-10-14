package conflicts

import (
	"slices"

	"bizzy-lambda/internal/platform/command"
	"bizzy-lambda/internal/platform/statemodel"
)

// View is a conflict as the API returns it: with its to-do and the quick
// actions that settle it, the remedies first.
type View struct {
	Conflict
	State State               `json:"state"`
	Rules []string            `json:"rules"`
	Todo  []statemodel.Reason `json:"todo"`
	// Fixes are every action that settles it: its violations' remedies,
	// then its rules' (with the conflict as their target).
	Fixes []command.Remedy `json:"fixes"`
}

func (c Conflict) View() View {
	st := c.State()
	v := View{Conflict: c, State: st, Rules: []string{}, Todo: Rules.Reasons(st), Fixes: c.Remedies()}
	if v.Todo == nil {
		v.Todo = []statemodel.Reason{}
	}
	for _, r := range Rules.Evaluate(st).Fired {
		v.Rules = append(v.Rules, r.ID)
	}
	for _, action := range Rules.Fixes(st) {
		if !slices.ContainsFunc(v.Fixes, func(r command.Remedy) bool { return r.Action == action }) {
			v.Fixes = append(v.Fixes, command.Remedy{Action: action, Target: c.Key, Label: labels[action]})
		}
	}
	if v.Fixes == nil {
		v.Fixes = []command.Remedy{}
	}
	return v
}

var labels = map[string]string{
	"calendar.revert": "Undo it in the calendar",
	"conflicts.apply": "Apply it",
	"calendar.ignore": "Not a session",
}

func Views(all []Conflict) []View {
	out := make([]View, len(all))
	for i, c := range all {
		out[i] = c.View()
	}
	return out
}

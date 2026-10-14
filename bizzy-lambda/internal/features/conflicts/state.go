package conflicts

import "bizzy-lambda/internal/platform/statemodel"

// State is a conflict reduced to the axes its rules read (see rules.go and
// testdata/states.md).
type State struct {
	Kind   Kind   `json:"kind"`
	Target Target `json:"target"`
	// Ready is whether anything still refuses the edit.
	Ready Ready `json:"ready"`
}

type Target string

const (
	TargetNone Target = "none"
	TargetSome Target = "some"
)

type Ready string

const (
	// Blocked: a guard refuses it.
	Blocked Ready = "blocked"
	// ReadyYes: nothing refuses it any more; it waits for her to apply it
	// (see googlesync's try).
	ReadyYes Ready = "ready"
)

var Axes = statemodel.Axes[State]{
	statemodel.NewAxis("kind", []Kind{KindNew, KindChanged, KindGone}, func(s *State, v Kind) { s.Kind = v }),
	statemodel.NewAxis("target", []Target{TargetNone, TargetSome}, func(s *State, v Target) { s.Target = v }),
	statemodel.NewAxis("ready", []Ready{Blocked, ReadyYes}, func(s *State, v Ready) { s.Ready = v }),
}

func (c Conflict) State() State {
	st := State{Kind: c.Kind, Target: TargetNone, Ready: Blocked}
	if c.TargetID != "" {
		st.Target = TargetSome
	}
	if len(c.Violations) == 0 {
		st.Ready = ReadyYes
	}
	return st
}

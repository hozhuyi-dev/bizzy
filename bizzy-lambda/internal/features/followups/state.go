package followups

import "bizzy-lambda/internal/platform/statemodel"

// State is a follow-up reduced to the axes its rules read (see rules.go
// and testdata/states.md).
type State struct {
	Done Done `json:"done"`
}

type Done string

const (
	Open    Done = "open"
	DoneYes Done = "done"
)

var Axes = statemodel.Axes[State]{
	statemodel.NewAxis("done", []Done{Open, DoneYes}, func(s *State, v Done) { s.Done = v }),
}

// State reduces the follow-up to its axes.
func (f FollowUp) State() State {
	st := State{Done: Open}
	if f.DoneAt != nil {
		st.Done = DoneYes
	}
	return st
}

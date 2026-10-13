package followups

import (
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/platform/statemodel"
)

// State is a follow-up reduced to the independent axes its rules read (see
// rules.go and testdata/states.md).
type State struct {
	Title Title
	Done  Done
}

// Title is how its calendar title reads against the clients.
type Title string

const (
	TitleMatched    Title = "matched"
	TitleNearMiss   Title = "near-miss"
	TitleUnmatched  Title = "unmatched"
	TitleUnreadable Title = "unreadable"
)

type Done string

const (
	Open    Done = "open"
	DoneYes Done = "done"
)

var Axes = statemodel.Axes[State]{
	statemodel.NewAxis("title", []Title{TitleMatched, TitleNearMiss, TitleUnmatched, TitleUnreadable}, func(s *State, v Title) { s.Title = v }),
	statemodel.NewAxis("done", []Done{Open, DoneYes}, func(s *State, v Done) { s.Done = v }),
}

// State reduces the follow-up to its axes.
func (f FollowUp) State() State {
	st := State{Title: TitleMatched, Done: Open}
	if f.DoneAt != nil {
		st.Done = DoneYes
	}
	// Match records a Problem whenever no client matched.
	switch {
	case f.Problem == "":
	case f.SuggestedClientID != "":
		st.Title = TitleNearMiss
	default:
		if _, err := calendar.ParseFollowUp(f.Title); err != nil {
			st.Title = TitleUnreadable
		} else {
			st.Title = TitleUnmatched
		}
	}
	return st
}

package documents

import "bizzy-lambda/internal/platform/statemodel"

// State is a document reduced to the independent axes its rules read (see
// rules.go and testdata/states.md). What it covers is checked against the
// sessions and packages themselves in internal/integrity.
type State struct {
	Status  Status
	Editing Editing
	Number  Numbered
	Share   ShareState
	Sources Covers
}

type Editing string

const (
	// EditingNone: nothing is being drafted.
	EditingNone Editing = "none"
	// EditingDraft: a draft is open, the first one or the next revision.
	EditingDraft Editing = "draft"
)

type Numbered string

const (
	NumberNone  Numbered = "none"
	NumberTaken Numbered = "taken"
)

type ShareState string

const (
	ShareNone ShareState = "none"
	ShareLink ShareState = "link"
)

type Covers string

const (
	CoversNothing Covers = "nothing"
	CoversItems   Covers = "items"
)

var Axes = statemodel.Axes[State]{
	statemodel.NewAxis("status", []Status{StatusDraft, StatusIssued, StatusCancelled}, func(s *State, v Status) { s.Status = v }),
	statemodel.NewAxis("editing", []Editing{EditingNone, EditingDraft}, func(s *State, v Editing) { s.Editing = v }),
	statemodel.NewAxis("number", []Numbered{NumberNone, NumberTaken}, func(s *State, v Numbered) { s.Number = v }),
	statemodel.NewAxis("share", []ShareState{ShareNone, ShareLink}, func(s *State, v ShareState) { s.Share = v }),
	statemodel.NewAxis("sources", []Covers{CoversNothing, CoversItems}, func(s *State, v Covers) { s.Sources = v }),
}

// State reduces the document to its axes.
func (d Document) State() State {
	st := State{Status: d.Status, Editing: EditingNone, Number: NumberNone, Share: ShareNone, Sources: CoversNothing}
	if d.Draft != nil {
		st.Editing = EditingDraft
	}
	if d.Number != "" {
		st.Number = NumberTaken
	}
	if d.ShareToken != "" {
		st.Share = ShareLink
	}
	if len(d.Sources) > 0 {
		st.Sources = CoversItems
	}
	return st
}

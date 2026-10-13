package expenses

import "bizzy-lambda/internal/platform/statemodel"

// State is an expense reduced to the independent axes its rules read (see
// testdata/states.md).
type State struct {
	Lines   Lines
	Total   Total
	Receipt Receipt
}

type Lines string

const (
	LinesNone Lines = "none"
	LinesSome Lines = "some"
)

type Total string

const (
	TotalZero     Total = "zero"
	TotalPositive Total = "positive"
)

// Receipt says whether a file is attached. One without (a parking meter, a
// toll) is fine: it is shown, but not put on the to-do list.
type Receipt string

const (
	ReceiptNone     Receipt = "none"
	ReceiptAttached Receipt = "attached"
)

var Axes = statemodel.Axes[State]{
	statemodel.NewAxis("lines", []Lines{LinesNone, LinesSome}, func(s *State, v Lines) { s.Lines = v }),
	statemodel.NewAxis("total", []Total{TotalZero, TotalPositive}, func(s *State, v Total) { s.Total = v }),
	statemodel.NewAxis("receipt", []Receipt{ReceiptNone, ReceiptAttached}, func(s *State, v Receipt) { s.Receipt = v }),
}

// State reduces the expense to its axes.
func (e Expense) State() State {
	st := State{Lines: LinesSome, Total: TotalPositive, Receipt: ReceiptAttached}
	if len(e.Lines) == 0 {
		st.Lines = LinesNone
	}
	if e.TotalCents() <= 0 {
		st.Total = TotalZero
	}
	if e.Files == 0 {
		st.Receipt = ReceiptNone
	}
	return st
}

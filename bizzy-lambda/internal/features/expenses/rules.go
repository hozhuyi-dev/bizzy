package expenses

import "bizzy-lambda/internal/platform/statemodel"

// Rules is the expense's rule table. An expense puts nothing on the to-do
// list: it is written once, complete.
var Rules = statemodel.Rules[State]{
	{
		ID: "no-lines", Bucket: statemodel.Impossible,
		Why:       "An expense is something bought, so it has at least one line",
		When:      func(s State) bool { return s.Lines == LinesNone },
		GuardedBy: []string{"expenses.save"},
	},
	{
		ID: "nothing-spent", Bucket: statemodel.Impossible,
		Why:       "An expense comes to more than nothing",
		When:      func(s State) bool { return s.Total == TotalZero },
		GuardedBy: []string{"expenses.save"},
	},
}

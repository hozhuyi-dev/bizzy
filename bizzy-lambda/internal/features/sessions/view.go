package sessions

import (
	"context"
	"time"

	"bizzy-lambda/internal/platform/statemodel"
)

// View is a session as the API returns it: what is stored, and what its
// rules and guards make of it as of now. The app reads these instead of
// re-deriving them, so a rule lives only in rules.go and the guard tables.
type View struct {
	Session
	// State is the session on its axes (state.go).
	State State `json:"state"`
	// Rules are the rules that hold, in priority order (rules.go); none
	// when it is quiet.
	Rules []string `json:"rules"`
	// Todo is what is left to do on it now.
	Todo []Reason `json:"todo"`
	// Fixes are the actions its to-do rules say resolve them (ResolvedBy):
	// the app offers these as its to-do item's quick actions.
	Fixes []string `json:"fixes"`
	// OwedCents is what is still to collect with it: its fee unless
	// received, plus the package bought in it unless paid.
	OwedCents int64 `json:"owedCents"`
	// Settled says nothing more is owed on it.
	Settled bool `json:"settled"`
	Can     Can  `json:"can"`
}

// Can is what each action on the session would say now: Record and Attach
// from its own guards, the rest from the book's (see book.Judge).
type Can struct {
	Record      statemodel.Verdict `json:"record"`
	Attach      statemodel.Verdict `json:"attach"`
	Pay         statemodel.Verdict `json:"pay"`
	UndoPayment statemodel.Verdict `json:"undoPayment"`
	Delete      statemodel.Verdict `json:"delete"`
}

// Judge says what the book's guards make of the actions on each session,
// by id.
type Judge func(ctx context.Context, all []Session) (map[string]Can, error)

// View is the session as of now, with the book's verdicts on it.
func (s Session) View(now time.Time, can Can) View {
	st := s.State(now)
	can.Record = statemodel.Check(s.CanRecord(now))
	can.Attach = statemodel.Check(s.CanAttach(now))
	v := View{
		Session: s, State: st, Rules: []string{}, Todo: Rules.Reasons(st),
		OwedCents: s.OwedCents() + s.BoughtOwedCents, Settled: s.Settled(), Can: can,
	}
	if v.Todo == nil {
		v.Todo = []Reason{}
	}
	if v.Fixes = Rules.Fixes(st); v.Fixes == nil {
		v.Fixes = []string{}
	}
	for _, r := range Rules.Evaluate(st).Fired {
		v.Rules = append(v.Rules, r.ID)
	}
	return v
}

// Views are sessions as of now, judged by judge (nil: the book's verdicts
// all no).
func Views(ctx context.Context, all []Session, now time.Time, judge Judge) ([]View, error) {
	var cans map[string]Can
	if judge != nil {
		var err error
		if cans, err = judge(ctx, all); err != nil {
			return nil, err
		}
	}
	out := make([]View, len(all))
	for i, s := range all {
		out[i] = s.View(now, cans[s.ID])
	}
	return out, nil
}

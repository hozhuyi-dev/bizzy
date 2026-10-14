package packages

import (
	"context"
	"time"

	"bizzy-lambda/internal/platform/statemodel"
)

// View is a package as the API returns it: what is stored, and what its
// rules and the book's guards make of it as of now. The app reads these
// instead of re-deriving them.
type View struct {
	Package
	// State is the package on its axes (state.go).
	State State `json:"state"`
	// Rules are the rules that hold, in priority order (rules.go).
	Rules []string `json:"rules"`
	// Todo is what is left to do on it now.
	Todo []statemodel.Reason `json:"todo"`
	// Fixes are the actions its to-do rules say resolve them (ResolvedBy).
	Fixes       []string `json:"fixes"`
	CreditsLeft int      `json:"creditsLeft"`
	OwedCents   int64    `json:"owedCents"`
	Can         Can      `json:"can"`
}

// Can is what each action on the package would say now (see book.Judge).
type Can struct {
	Pay         statemodel.Verdict `json:"pay"`
	UndoPayment statemodel.Verdict `json:"undoPayment"`
	Edit        statemodel.Verdict `json:"edit"`
	Delete      statemodel.Verdict `json:"delete"`
	// MakeStandalone keeps one bought in a session as one of its own.
	MakeStandalone statemodel.Verdict `json:"makeStandalone"`
}

// Judge says what the book's guards make of the actions on each package,
// by id.
type Judge func(ctx context.Context, all []Package) (map[string]Can, error)

// View is the package as of now, with the book's verdicts on it.
func (p Package) View(now time.Time, can Can) View {
	st := p.State(now)
	v := View{
		Package: p, State: st, Rules: []string{}, Todo: Rules.Reasons(st),
		CreditsLeft: p.CreditsLeft(), OwedCents: p.OwedCents(), Can: can,
	}
	if v.Todo == nil {
		v.Todo = []statemodel.Reason{}
	}
	if v.Fixes = Rules.Fixes(st); v.Fixes == nil {
		v.Fixes = []string{}
	}
	for _, r := range Rules.Evaluate(st).Fired {
		v.Rules = append(v.Rules, r.ID)
	}
	return v
}

// Views are packages as of now, judged by judge (nil: all no).
func Views(ctx context.Context, all []Package, now time.Time, judge Judge) ([]View, error) {
	var cans map[string]Can
	if judge != nil {
		var err error
		if cans, err = judge(ctx, all); err != nil {
			return nil, err
		}
	}
	out := make([]View, len(all))
	for i, p := range all {
		out[i] = p.View(now, cans[p.ID])
	}
	return out, nil
}

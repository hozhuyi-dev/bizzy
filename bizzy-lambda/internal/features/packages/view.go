package packages

import (
	"fmt"
	"time"

	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/shared/docref"
	"bizzy-lambda/internal/shared/money"
)

// View is a package as the API returns it: what is stored, and what its
// rules and guards make of it as of now. The app reads these instead of
// re-deriving them, so a rule lives only in rules.go and guards.go.
type View struct {
	Package
	// State is the package on its axes (state.go).
	State State `json:"state"`
	// Rules are the rules that hold, in priority order (rules.go).
	Rules []string `json:"rules"`
	// Todo is what is left to do on it now.
	Todo []statemodel.Reason `json:"todo"`
	// Fixes are the actions its to-do rules say resolve them (ResolvedBy):
	// the app offers these as its to-do item's quick actions.
	Fixes []string `json:"fixes"`
	// Problem explains what to fix, if anything.
	Problem     string `json:"problem,omitempty"`
	CreditsLeft int    `json:"creditsLeft"`
	// OwedCents is its price while not settled (paid, waived or free).
	OwedCents int64 `json:"owedCents"`
	Can       Can   `json:"can"`
}

// Can is what each action on the package would say now (guards.go).
type Can struct {
	Pay     statemodel.Verdict `json:"pay"`
	Invoice statemodel.Verdict `json:"invoice"`
	Receipt statemodel.Verdict `json:"receipt"`
	Edit    statemodel.Verdict `json:"edit"`
	Delete  statemodel.Verdict `json:"delete"`
	// MakeStandalone keeps a package the calendar no longer buys.
	MakeStandalone statemodel.Verdict `json:"makeStandalone"`
}

// View is the package as of now.
func (p Package) View(now time.Time) View {
	st := p.State(now)
	v := View{
		Package: p, State: st, Rules: []string{}, Todo: Rules.Reasons(st), CreditsLeft: p.CreditsLeft(),
		Can: Can{
			Pay:     statemodel.Check(p.CanPay()),
			Invoice: statemodel.Check(p.CanBill(docref.SlotInvoice)),
			Receipt: statemodel.Check(p.CanBill(docref.SlotReceipt)),
			Edit:    statemodel.Check(p.CanEdit()),
			Delete:  statemodel.Check(p.CanDelete()),

			MakeStandalone: statemodel.Check(p.CanMakeStandalone()),
		},
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
	if !p.Settled() {
		v.OwedCents = p.PriceCents
	}
	switch {
	case p.Drift != "":
		v.Problem = p.Drift
	case p.Payment.Outdated(p.PriceCents):
		v.Problem = fmt.Sprintf("The price is now %s; %s was paid", money.Format(p.PriceCents), money.Format(p.Payment.AmountCents))
	}
	return v
}

// Views are packages as of now.
func Views(all []Package, now time.Time) []View {
	out := make([]View, len(all))
	for i, p := range all {
		out[i] = p.View(now)
	}
	return out
}

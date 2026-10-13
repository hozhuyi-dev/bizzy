package sessions

import (
	"fmt"
	"time"

	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/shared/money"
)

// View is a session as the API returns it: what is stored, and what its
// rules and guards make of it as of now. The app reads these instead of
// re-deriving them, so a rule lives only in rules.go and guards.go.
type View struct {
	Session
	// State is the session on its axes (state.go).
	State State `json:"state"`
	// Rules are the rules that hold, in priority order (rules.go); none
	// when it is quiet.
	Rules []string `json:"rules"`
	// Todo is what is left to do on it now.
	Todo []Reason `json:"todo"`
	// Problem explains the first thing to fix, if any.
	Problem string `json:"problem,omitempty"`
	// DueCents is its own fee, when one applies. OwedCents is what is still
	// to collect with it: that fee unless settled, plus BoughtOwedCents, the
	// package bought in it unless paid.
	DueCents        int64 `json:"dueCents"`
	OwedCents       int64 `json:"owedCents"`
	BoughtOwedCents int64 `json:"boughtOwedCents"`
	// Delivered says it counts as having happened with a client, fee known
	// or not; Paid that nothing more is owed on it.
	Delivered bool `json:"delivered"`
	Paid      bool `json:"paid"`
	Can       Can  `json:"can"`
}

// Can is what each action on the session would say now (guards.go).
type Can struct {
	Settle      statemodel.Verdict `json:"settle"`
	Pay         statemodel.Verdict `json:"pay"`
	UndoPayment statemodel.Verdict `json:"undoPayment"`
	Invoice     statemodel.Verdict `json:"invoice"`
	Receipt     statemodel.Verdict `json:"receipt"`
	Record      statemodel.Verdict `json:"record"`
	Attach      statemodel.Verdict `json:"attach"`
	EditBooking statemodel.Verdict `json:"editBooking"`
	Restore     statemodel.Verdict `json:"restore"`
	Discard     statemodel.Verdict `json:"discard"`
}

// View is the session as of now.
func (s Session) View(now time.Time) View {
	st := s.State(now)
	v := View{
		Session: s, State: st, Rules: []string{}, Todo: Rules.Reasons(st),
		DueCents: s.DueCents(), Delivered: s.Status.Delivered(), Paid: s.Paid(),
		Can: Can{
			Settle:      statemodel.Check(s.CanSettle()),
			Pay:         statemodel.Check(s.CanPay()),
			UndoPayment: statemodel.Check(s.CanUndoPayment()),
			Invoice:     statemodel.Check(s.CanInvoice()),
			Receipt:     statemodel.Check(s.CanReceipt()),
			Record:      statemodel.Check(s.CanRecord(now)),
			Attach:      statemodel.Check(s.CanAttach(now)),
			EditBooking: statemodel.Check(s.CanEditBooking()),
			Restore:     statemodel.Check(s.CanRestore()),
			Discard:     statemodel.Check(s.CanDiscard()),
		},
	}
	if v.Todo == nil {
		v.Todo = []Reason{}
	}
	for _, r := range Rules.Evaluate(st).Fired {
		v.Rules = append(v.Rules, r.ID)
	}
	if feeOwed(st) {
		v.OwedCents = v.DueCents
	}
	if boughtOwed(st) {
		v.BoughtOwedCents = s.BoughtCents
		v.OwedCents += s.BoughtCents
	}
	v.Problem = s.problem()
	return v
}

// problem explains why the session needs fixing, in the order its rules
// put it; "" when it doesn't.
func (s Session) problem() string {
	switch {
	case s.Drift != "":
		return s.Drift
	case s.Payment.Outdated(s.DueCents()):
		return fmt.Sprintf("The fee is now %s; %s was paid", money.Format(s.DueCents()), money.Format(s.Payment.AmountCents))
	case s.Status == StatusParseError || s.Status == StatusUnmatched || s.Status == StatusMissingFee:
		return s.Reason
	case s.Status == StatusTentative && s.ClientID == "":
		return s.Reason
	}
	return ""
}

// Views are sessions as of now.
func Views(all []Session, now time.Time) []View {
	out := make([]View, len(all))
	for i, s := range all {
		out[i] = s.View(now)
	}
	return out
}

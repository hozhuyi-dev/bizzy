package packages

import (
	"time"

	"bizzy-lambda/internal/platform/statemodel"
)

const (
	// ReasonFix: an issued document contradicts it.
	ReasonFix statemodel.Reason = "fix"
	// ReasonCollect: bought, and not paid.
	ReasonCollect statemodel.Reason = "collect"
)

// Rules is the package's rule table, in priority order. A package bought in
// a session's title is collected with that session (see sessions.Rules), so
// only one bought otherwise is collected on its own.
var Rules = statemodel.Rules[State]{
	{
		ID: "contradicts-document", Bucket: statemodel.Contradiction, Reason: ReasonFix, Stop: true,
		Why:        "The calendar changed after an invoice or receipt was issued: the event names another client, or moved",
		When:       func(s State) bool { return s.Drift == Drifted },
		ResolvedBy: []string{"documents.revise", "documents.cancel"},
	},
	{
		ID: "price-changed-after-payment", Bucket: statemodel.Contradiction, Reason: ReasonFix, Stop: true,
		Why:        "The calendar changed the price after it was paid, and the amount paid doesn't match it",
		When:       func(s State) bool { return s.PaidFor == PaidForOutdated },
		ResolvedBy: []string{"payments.set", "sessions.update"},
	},
	{
		ID: "unpaid", Bucket: statemodel.NeedsAction, Reason: ReasonCollect,
		Why: "Bought outside the calendar, and not paid",
		When: func(s State) bool {
			return s.Source == SourceApp && s.Timing == Purchased && s.Price == Priced && s.Payment == PaymentNone
		},
		ResolvedBy: []string{"payments.set"},
	},
	{
		ID: "drift-without-issued-document", Bucket: statemodel.Impossible,
		Why:            "Drift compares the calendar with an issued document",
		When:           func(s State) bool { return s.Drift == Drifted && s.Invoice != SlotIssued && s.Receipt != SlotIssued },
		ByConstruction: "the reconcile only sets drift against an issued document",
	},
	{
		ID: "outdated-without-payment", Bucket: statemodel.Impossible,
		Why:            "Only money received can settle an old price",
		When:           func(s State) bool { return s.PaidFor == PaidForOutdated && s.Payment != PaymentPaid },
		ByConstruction: "Payment.Outdated holds only for a payment received",
	},
	{
		ID: "receipt-without-payment", Bucket: statemodel.Impossible,
		Why:       "A receipt confirms money received",
		When:      func(s State) bool { return s.Receipt != SlotEmpty && s.Payment != PaymentPaid },
		GuardedBy: []string{"documents.createDraft", "payments.set"},
	},
}

// Todo is what is left to do on the package as of now; nil when nothing.
func (p Package) Todo(now time.Time) []statemodel.Reason {
	return Rules.Reasons(p.State(now))
}

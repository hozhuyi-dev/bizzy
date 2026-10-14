package packages

import (
	"time"

	"bizzy-lambda/internal/platform/statemodel"
)

// ReasonCollect: bought, and not paid.
const ReasonCollect statemodel.Reason = "collect"

// Rules is the package's rule table, in priority order. A package bought in
// a session is collected with that session (see sessions.Rules), so only
// one bought on its own is collected as itself. Like a session, a package
// has no contradictions: its money is its documents'.
var Rules = statemodel.Rules[State]{
	{
		ID: "unpaid", Bucket: statemodel.NeedsAction, Reason: ReasonCollect,
		Why: "Bought on its own, and not paid",
		When: func(s State) bool {
			return s.Origin == OnItsOwn && s.Timing == Purchased && s.Price == Priced && s.Payment == PaymentNone
		},
		ResolvedBy: []string{"payments.set"},
	},

	{
		ID: "invoiced", Bucket: statemodel.Impossible,
		Why:            "A package is always on an invoice, which says its price",
		When:           func(s State) bool { return s.Invoice == SlotEmpty },
		ByConstruction: "buying a package puts it on a draft invoice, and nothing takes it off one but deleting it",
	},
	{
		ID: "overdrawn", Bucket: statemodel.Impossible,
		Why:       "No more sessions use a package's credits than it has",
		When:      func(s State) bool { return s.Credits == CreditsOverdrawn },
		GuardedBy: []string{"packages.save", "sessions.update"},
	},
	{
		ID: "receipt-is-the-payment", Bucket: statemodel.Impossible,
		Why:            "What was received is what its receipt says",
		When:           func(s State) bool { return (s.Receipt != SlotEmpty) != (s.Payment == PaymentPaid) },
		ByConstruction: "Paid is copied from the receipt's line",
	},
	{
		ID: "paid-nothing-due", Bucket: statemodel.Impossible,
		Why:       "Only what is owed is paid",
		When:      func(s State) bool { return s.Payment == PaymentPaid && s.Price == Free },
		GuardedBy: []string{"payments.set", "packages.save", "documents.saveDraft"},
	},
}

// Todo is what is left to do on the package as of now; nil when nothing.
func (p Package) Todo(now time.Time) []statemodel.Reason {
	return Rules.Reasons(p.State(now))
}

package sessions

import "bizzy-lambda/internal/platform/statemodel"

// Reason is why a session is on the to-do list.
type Reason = statemodel.Reason

const (
	// ReasonConfirm: still tentative.
	ReasonConfirm Reason = "confirm"
	// ReasonRecord: happened, with no summary yet.
	ReasonRecord Reason = "record"
	// ReasonCollect: happened, and not paid.
	ReasonCollect Reason = "collect"
)

// Rules is the session's rule table, in priority order: a Stop rule hides
// the reasons after it, as there is no point recording a session still
// tentative. The to-do list (Todo, Open) is derived from it;
// testdata/states.md shows it over every state.
//
// A session has no contradictions of its own: the calendar can't change it
// behind the app's back (an edit there that isn't allowed waits as a
// conflict, see internal/features/conflicts), and its money is its
// documents', so the two can't disagree. The impossible rules are what the
// book's guards and its Derive keep from happening (see
// internal/features/book).
var Rules = statemodel.Rules[State]{
	{
		ID: "unconfirmed", Bucket: statemodel.NeedsAction, Reason: ReasonConfirm, Stop: true,
		Why:        "Still tentative (`?` title)",
		When:       func(s State) bool { return s.Confirmed == Tentative },
		ResolvedBy: []string{"sessions.update", "sessions.delete"},
	},
	{
		ID: "unrecorded", Bucket: statemodel.NeedsAction, Reason: ReasonRecord,
		Why:        "Happened, with no summary written",
		When:       func(s State) bool { return s.Timing == Happened && s.Record != RecordSummary },
		ResolvedBy: []string{"sessions.saveRecord"},
	},
	{
		ID: "unpaid", Bucket: statemodel.NeedsAction, Reason: ReasonCollect,
		Why:        "Happened, and its fee or the package bought in it is still owed",
		When:       func(s State) bool { return s.Timing == Happened && owes(s) },
		ResolvedBy: []string{"payments.set"},
	},

	{
		ID: "credit-with-invoice", Bucket: statemodel.Impossible,
		Why:            "A credit leaves nothing to invoice, and a fee is always on an invoice",
		When:           func(s State) bool { return (s.Cover == CoverCredit) == (s.Invoice != SlotEmpty) },
		ByConstruction: "the book puts a session's fee on an invoice whenever no credit covers it, and takes it off when one does",
	},
	{
		ID: "credit-with-fee", Bucket: statemodel.Impossible,
		Why:            "A credit leaves nothing to pay on the session itself",
		When:           func(s State) bool { return s.Cover == CoverCredit && s.Fee == FeeCharged },
		ByConstruction: "the fee is its invoice line's, and a credit has none",
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
		When:      func(s State) bool { return s.Payment == PaymentPaid && s.Fee == FeeNothingDue },
		GuardedBy: []string{"payments.set", "sessions.update", "documents.saveDraft"},
	},
	{
		ID: "tentative-with-issued-invoice", Bucket: statemodel.Impossible,
		Why:       "An invoice is issued for a confirmed session",
		When:      func(s State) bool { return s.Confirmed == Tentative && s.Invoice == SlotIssued },
		GuardedBy: []string{"documents.issue", "sessions.update"},
	},
}

// feeOwed: the session's own fee is due and not received.
func feeOwed(s State) bool {
	return s.Fee == FeeCharged && s.Payment == PaymentNone
}

// owes: its fee, or the package bought in it, is still to be paid.
func owes(s State) bool {
	return feeOwed(s) || s.Bought == BoughtDue
}

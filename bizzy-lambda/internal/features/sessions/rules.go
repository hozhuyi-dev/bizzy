package sessions

import "bizzy-lambda/internal/platform/statemodel"

// Reason is why a session is on the to-do list.
type Reason = statemodel.Reason

const (
	// ReasonDeleted: gone from the calendar with data on it; restore or
	// discard it.
	ReasonDeleted Reason = "deleted"
	// ReasonFix: the calendar entry can't be read, matched or priced, or a
	// document contradicts it.
	ReasonFix Reason = "fix"
	// ReasonConfirm: still tentative.
	ReasonConfirm Reason = "confirm"
	// ReasonRecord: happened, with no summary yet.
	ReasonRecord Reason = "record"
	// ReasonCollect: happened, and not paid.
	ReasonCollect Reason = "collect"
)

// Rules is the session's rule table, in priority order: each Stop rule
// hides the reasons after it, as there is no point confirming a session no
// client matches, or recording one still tentative. The to-do list (Todo,
// Open) is derived from it; testdata/states.md shows it over every state.
var Rules = statemodel.Rules[State]{
	{
		ID: "deleted", Bucket: statemodel.Contradiction, Reason: ReasonDeleted, Stop: true,
		Why:        "Gone from the calendar, kept for what was recorded on it",
		When:       func(s State) bool { return s.Presence == Removed },
		ResolvedBy: []string{"sessions.restore", "sessions.discard"},
	},
	{
		ID: "title-unreadable", Bucket: statemodel.Contradiction, Reason: ReasonFix, Stop: true,
		Why:        "The calendar title can't be read",
		When:       func(s State) bool { return s.Status == StatusParseError },
		ResolvedBy: []string{"sessions.update"},
	},
	{
		ID: "client-unmatched", Bucket: statemodel.Contradiction, Reason: ReasonFix, Stop: true,
		Why:        "No client has the name in the title",
		When:       func(s State) bool { return s.Status == StatusUnmatched },
		ResolvedBy: []string{"sessions.update", "clients.save"},
	},
	{
		ID: "fee-missing", Bucket: statemodel.Contradiction, Reason: ReasonFix, Stop: true,
		Why:        "No amount in the title, no package credit and no fee set for the client",
		When:       func(s State) bool { return s.Status == StatusMissingFee },
		ResolvedBy: []string{"sessions.update", "clients.save", "packages.save"},
	},
	{
		ID: "tentative-unknown-client", Bucket: statemodel.Contradiction, Reason: ReasonFix, Stop: true,
		Why:        "Tentative under a name no client has",
		When:       func(s State) bool { return s.Status == StatusTentative && s.Client == ClientNone },
		ResolvedBy: []string{"sessions.update", "clients.save"},
	},
	{
		ID: "contradicts-document", Bucket: statemodel.Contradiction, Reason: ReasonFix, Stop: true,
		Why:        "The calendar changed after an invoice or receipt was issued",
		When:       func(s State) bool { return s.Drift == Drifted },
		ResolvedBy: []string{"documents.revise", "documents.cancel"},
	},
	{
		ID: "fee-changed-after-payment", Bucket: statemodel.Contradiction, Reason: ReasonFix, Stop: true,
		Why:        "The calendar changed the fee after it was paid, and the amount paid doesn't match it",
		When:       func(s State) bool { return s.PaidFor == PaidForOutdated },
		ResolvedBy: []string{"payments.set", "sessions.update"},
	},
	{
		ID: "unconfirmed", Bucket: statemodel.NeedsAction, Reason: ReasonConfirm, Stop: true,
		Why:        "Still tentative (`?` title)",
		When:       func(s State) bool { return s.Status == StatusTentative },
		ResolvedBy: []string{"sessions.update"},
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
		ID: "removed-status-mismatch", Bucket: statemodel.Impossible,
		Why:            "Removed exactly when its status says so",
		When:           func(s State) bool { return (s.Presence == Removed) != (s.Status == StatusRemoved) },
		ByConstruction: "the reconcile derives the removed status from the event being gone",
	},
	{
		ID: "removed-without-data", Bucket: statemodel.Impossible,
		Why: "A removed session is kept only for what was recorded on it",
		When: func(s State) bool {
			return s.Presence == Removed && s.Record == RecordNone && s.Payment == PaymentNone &&
				s.Invoice == SlotEmpty && s.Receipt == SlotEmpty
		},
		GuardedBy:      []string{"sessions.saveRecord", "attachments.delete"},
		ByConstruction: "the reconcile deletes a session gone from the calendar with nothing on it",
	},
	{
		ID: "fee-owed-unpriced", Bucket: statemodel.Impossible,
		Why:            "Only a priced session owes a fee of its own",
		When:           func(s State) bool { return s.Fee == FeeOwed && s.Status != StatusPriced },
		ByConstruction: "DueCents charges only a priced session",
	},
	{
		ID: "drift-without-issued-document", Bucket: statemodel.Impossible,
		Why:            "Drift compares the calendar with an issued document",
		When:           func(s State) bool { return s.Drift == Drifted && s.Invoice != SlotIssued && s.Receipt != SlotIssued },
		ByConstruction: "the reconcile only sets drift against an issued document",
	},
	{
		ID: "outdated-without-payment", Bucket: statemodel.Impossible,
		Why:            "Only money received can settle an old fee",
		When:           func(s State) bool { return s.PaidFor == PaidForOutdated && s.Payment != PaymentPaid },
		ByConstruction: "Payment.Outdated holds only for a payment received",
	},
	{
		ID: "paid-on-credit", Bucket: statemodel.Impossible,
		Why:            "A package credit leaves nothing to pay on the session itself",
		When:           func(s State) bool { return s.Status == StatusPackage && s.Payment != PaymentNone },
		GuardedBy:      []string{"payments.set"},
		ByConstruction: "the reconcile gives a paid session its own fee, never a credit",
	},
	{
		ID: "receipt-without-payment", Bucket: statemodel.Impossible,
		Why:       "A receipt confirms money received",
		When:      func(s State) bool { return s.Receipt != SlotEmpty && s.Payment != PaymentPaid },
		GuardedBy: []string{"documents.createDraft", "payments.set"},
	},
}

// feeOwed: the session's own fee is due and neither paid nor waived.
func feeOwed(s State) bool {
	return s.Fee == FeeOwed && s.Payment == PaymentNone
}

// boughtOwed: the package bought in the session is still to be paid. It is
// paid on the package (see packages.Package.Payment), but collected with
// the session.
func boughtOwed(s State) bool {
	return s.Bought == BoughtDue && s.Status.Delivered()
}

func owes(s State) bool {
	return feeOwed(s) || boughtOwed(s)
}

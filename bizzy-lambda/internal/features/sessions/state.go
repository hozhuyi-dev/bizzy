package sessions

import (
	"time"

	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/shared/docref"
)

// State is a session reduced to the independent axes its rules read (see
// rules.go). Every field is a small enum, so the tests can enumerate every
// combination (testdata/states.md).
type State struct {
	Presence Presence `json:"presence"`
	// Status is how the title reads, as the billing reconcile derived it.
	Status  Status       `json:"status"`
	Client  ClientMatch  `json:"client"`
	Timing  Timing       `json:"timing"`
	Record  Recording    `json:"record"`
	Fee     Fee          `json:"fee"`
	Payment PaymentState `json:"payment"`
	// PaidFor says whether the payment settled the fee as it is now.
	PaidFor PaidFor `json:"paidFor"`
	// Bought is the package bought in the session, collected with it.
	Bought  Bought  `json:"bought"`
	Invoice DocSlot `json:"invoice"`
	Receipt DocSlot `json:"receipt"`
	Drift   Drift   `json:"drift"`
}

type Presence string

const (
	InCalendar Presence = "in-calendar"
	// Removed: gone from the calendar, kept for what was recorded on it.
	Removed Presence = "removed"
)

type ClientMatch string

const (
	ClientMatched ClientMatch = "matched"
	ClientNone    ClientMatch = "none"
)

type Timing string

const (
	Upcoming Timing = "upcoming"
	// Happened: it has ended.
	Happened Timing = "happened"
)

type Recording string

const (
	RecordNone Recording = "none"
	// RecordNotesOnly: long notes but no summary yet.
	RecordNotesOnly Recording = "notes-only"
	RecordSummary   Recording = "summary"
)

type Fee string

const (
	// FeeNothingDue: no fee of its own (a package credit, or a fee of 0).
	FeeNothingDue Fee = "nothing-due"
	FeeOwed       Fee = "owed"
)

type PaymentState string

const (
	PaymentNone   PaymentState = "none"
	PaymentPaid   PaymentState = "paid"
	PaymentWaived PaymentState = "waived"
)

type PaidFor string

const (
	PaidForCurrent PaidFor = "current"
	// PaidForOutdated: the fee changed since it was paid, and the amount
	// paid doesn't match it either.
	PaidForOutdated PaidFor = "outdated"
)

type Bought string

const (
	BoughtNone    Bought = "none"
	BoughtDue     Bought = "due"
	BoughtSettled Bought = "settled"
)

type DocSlot string

const (
	SlotEmpty  DocSlot = "empty"
	SlotDraft  DocSlot = "draft"
	SlotIssued DocSlot = "issued"
)

type Drift string

const (
	DriftNone Drift = "none"
	// Drifted: the calendar now contradicts an issued document.
	Drifted Drift = "drifted"
)

// Axes lists every value of every axis, in the order the table shows them.
var Axes = statemodel.Axes[State]{
	statemodel.NewAxis("presence", []Presence{InCalendar, Removed}, func(s *State, v Presence) { s.Presence = v }),
	statemodel.NewAxis("status", []Status{StatusTentative, StatusParseError, StatusUnmatched, StatusMissingFee, StatusPriced, StatusPackage, StatusRemoved}, func(s *State, v Status) { s.Status = v }),
	statemodel.NewAxis("client", []ClientMatch{ClientMatched, ClientNone}, func(s *State, v ClientMatch) { s.Client = v }),
	statemodel.NewAxis("timing", []Timing{Upcoming, Happened}, func(s *State, v Timing) { s.Timing = v }),
	statemodel.NewAxis("record", []Recording{RecordNone, RecordNotesOnly, RecordSummary}, func(s *State, v Recording) { s.Record = v }),
	statemodel.NewAxis("fee", []Fee{FeeNothingDue, FeeOwed}, func(s *State, v Fee) { s.Fee = v }),
	statemodel.NewAxis("payment", []PaymentState{PaymentNone, PaymentPaid, PaymentWaived}, func(s *State, v PaymentState) { s.Payment = v }),
	statemodel.NewAxis("paid for", []PaidFor{PaidForCurrent, PaidForOutdated}, func(s *State, v PaidFor) { s.PaidFor = v }),
	statemodel.NewAxis("bought", []Bought{BoughtNone, BoughtDue, BoughtSettled}, func(s *State, v Bought) { s.Bought = v }),
	statemodel.NewAxis("invoice", []DocSlot{SlotEmpty, SlotDraft, SlotIssued}, func(s *State, v DocSlot) { s.Invoice = v }),
	statemodel.NewAxis("receipt", []DocSlot{SlotEmpty, SlotDraft, SlotIssued}, func(s *State, v DocSlot) { s.Receipt = v }),
	statemodel.NewAxis("drift", []Drift{DriftNone, Drifted}, func(s *State, v Drift) { s.Drift = v }),
}

// State reduces the session to its axes as of now.
func (s Session) State(now time.Time) State {
	st := State{
		Presence: InCalendar, Status: s.Status, Client: ClientMatched, Timing: Happened,
		Record: RecordNone, Fee: FeeNothingDue, Payment: PaymentNone, PaidFor: PaidForCurrent, Bought: BoughtNone,
		Invoice: slotOf(s.Invoice), Receipt: slotOf(s.Receipt), Drift: DriftNone,
	}
	if s.RemovedAt != nil {
		st.Presence = Removed
	}
	if s.ClientID == "" {
		st.Client = ClientNone
	}
	if s.End.After(now) {
		st.Timing = Upcoming
	}
	switch {
	case s.Record != nil && s.Record.Summary != "":
		st.Record = RecordSummary
	case s.Record != nil:
		st.Record = RecordNotesOnly
	}
	if s.DueCents() > 0 {
		st.Fee = FeeOwed
	}
	switch {
	case s.Payment.IsPaid():
		st.Payment = PaymentPaid
	case s.Payment != nil:
		st.Payment = PaymentWaived
	}
	switch {
	case s.BoughtCents > 0 && s.BoughtSettled:
		st.Bought = BoughtSettled
	case s.BoughtCents > 0:
		st.Bought = BoughtDue
	}
	if s.Payment.Outdated(s.DueCents()) {
		st.PaidFor = PaidForOutdated
	}
	if s.Drift != "" {
		st.Drift = Drifted
	}
	return st
}

func slotOf(ref *docref.Ref) DocSlot {
	switch {
	case ref.Issued():
		return SlotIssued
	case ref != nil:
		return SlotDraft
	default:
		return SlotEmpty
	}
}

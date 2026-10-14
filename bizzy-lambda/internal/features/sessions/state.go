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
	Confirmed Confirmation `json:"confirmed"`
	Timing    Timing       `json:"timing"`
	Record    Recording    `json:"record"`
	Cover     Cover        `json:"cover"`
	Fee       Fee          `json:"fee"`
	Invoice   DocSlot      `json:"invoice"`
	Receipt   DocSlot      `json:"receipt"`
	Payment   PaymentState `json:"payment"`
	// Bought is the package bought in the session, collected with it.
	Bought Bought `json:"bought"`
}

type Confirmation string

const (
	Tentative Confirmation = "tentative"
	Confirmed Confirmation = "confirmed"
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
	// RecordNotesOnly: long notes or attached files, but no summary yet.
	RecordNotesOnly Recording = "notes-only"
	RecordSummary   Recording = "summary"
)

type Cover string

const (
	// CoverFee: its fee is charged on an invoice.
	CoverFee    Cover = "fee"
	CoverCredit Cover = "credit"
)

type Fee string

const (
	// FeeNothingDue: no fee of its own (a credit, or a fee of 0).
	FeeNothingDue Fee = "nothing-due"
	FeeCharged    Fee = "charged"
)

type DocSlot string

const (
	SlotEmpty  DocSlot = "empty"
	SlotDraft  DocSlot = "draft"
	SlotIssued DocSlot = "issued"
)

type PaymentState string

const (
	PaymentNone PaymentState = "none"
	PaymentPaid PaymentState = "paid"
)

type Bought string

const (
	BoughtNone    Bought = "none"
	BoughtDue     Bought = "due"
	BoughtSettled Bought = "settled"
)

// Axes lists every value of every axis, in the order the table shows them.
var Axes = statemodel.Axes[State]{
	statemodel.NewAxis("confirmed", []Confirmation{Tentative, Confirmed}, func(s *State, v Confirmation) { s.Confirmed = v }),
	statemodel.NewAxis("timing", []Timing{Upcoming, Happened}, func(s *State, v Timing) { s.Timing = v }),
	statemodel.NewAxis("record", []Recording{RecordNone, RecordNotesOnly, RecordSummary}, func(s *State, v Recording) { s.Record = v }),
	statemodel.NewAxis("cover", []Cover{CoverFee, CoverCredit}, func(s *State, v Cover) { s.Cover = v }),
	statemodel.NewAxis("fee", []Fee{FeeNothingDue, FeeCharged}, func(s *State, v Fee) { s.Fee = v }),
	statemodel.NewAxis("invoice", []DocSlot{SlotEmpty, SlotDraft, SlotIssued}, func(s *State, v DocSlot) { s.Invoice = v }),
	statemodel.NewAxis("receipt", []DocSlot{SlotEmpty, SlotDraft, SlotIssued}, func(s *State, v DocSlot) { s.Receipt = v }),
	statemodel.NewAxis("payment", []PaymentState{PaymentNone, PaymentPaid}, func(s *State, v PaymentState) { s.Payment = v }),
	statemodel.NewAxis("bought", []Bought{BoughtNone, BoughtDue, BoughtSettled}, func(s *State, v Bought) { s.Bought = v }),
}

// State reduces the session to its axes as of now.
func (s Session) State(now time.Time) State {
	st := State{
		Confirmed: Confirmed, Timing: Happened, Record: RecordNone, Cover: CoverFee, Fee: FeeNothingDue,
		Invoice: SlotOf(s.Invoice), Receipt: SlotOf(s.Receipt), Payment: PaymentNone, Bought: BoughtNone,
	}
	if s.Tentative {
		st.Confirmed = Tentative
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
	if s.OnCredit() {
		st.Cover = CoverCredit
	}
	if s.FeeCents > 0 {
		st.Fee = FeeCharged
	}
	if s.Paid != nil {
		st.Payment = PaymentPaid
	}
	switch {
	case s.BoughtPackageID != "" && s.BoughtOwedCents > 0:
		st.Bought = BoughtDue
	case s.BoughtPackageID != "":
		st.Bought = BoughtSettled
	}
	return st
}

// SlotOf is how far the document in a slot has gone.
func SlotOf(ref *docref.Ref) DocSlot {
	switch {
	case ref.Issued():
		return SlotIssued
	case ref != nil:
		return SlotDraft
	default:
		return SlotEmpty
	}
}

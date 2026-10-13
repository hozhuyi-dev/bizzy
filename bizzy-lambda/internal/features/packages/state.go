package packages

import (
	"time"

	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/shared/docref"
)

// State is a package reduced to the independent axes its rules read (see
// rules.go and testdata/states.md).
type State struct {
	Source  Source       `json:"source"`
	Timing  Timing       `json:"timing"`
	Credits Credits      `json:"credits"`
	Price   Price        `json:"price"`
	Payment PaymentState `json:"payment"`
	// PaidFor says whether the payment settled the price as it is now.
	PaidFor PaidFor `json:"paidFor"`
	Invoice DocSlot `json:"invoice"`
	Receipt DocSlot `json:"receipt"`
	Drift   Drift   `json:"drift"`
}

type Timing string

const (
	// Ahead: bought in a session still to come.
	Ahead     Timing = "ahead"
	Purchased Timing = "purchased"
)

type Credits string

const (
	CreditsLeft   Credits = "left"
	CreditsUsedUp Credits = "used-up"
)

type Price string

const (
	Free   Price = "free"
	Priced Price = "priced"
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
	// PaidForOutdated: the price changed since it was paid, and the amount
	// paid doesn't match it either.
	PaidForOutdated PaidFor = "outdated"
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

var Axes = statemodel.Axes[State]{
	statemodel.NewAxis("source", []Source{SourceCalendar, SourceApp}, func(s *State, v Source) { s.Source = v }),
	statemodel.NewAxis("timing", []Timing{Ahead, Purchased}, func(s *State, v Timing) { s.Timing = v }),
	statemodel.NewAxis("credits", []Credits{CreditsLeft, CreditsUsedUp}, func(s *State, v Credits) { s.Credits = v }),
	statemodel.NewAxis("price", []Price{Free, Priced}, func(s *State, v Price) { s.Price = v }),
	statemodel.NewAxis("payment", []PaymentState{PaymentNone, PaymentPaid, PaymentWaived}, func(s *State, v PaymentState) { s.Payment = v }),
	statemodel.NewAxis("paid for", []PaidFor{PaidForCurrent, PaidForOutdated}, func(s *State, v PaidFor) { s.PaidFor = v }),
	statemodel.NewAxis("invoice", []DocSlot{SlotEmpty, SlotDraft, SlotIssued}, func(s *State, v DocSlot) { s.Invoice = v }),
	statemodel.NewAxis("receipt", []DocSlot{SlotEmpty, SlotDraft, SlotIssued}, func(s *State, v DocSlot) { s.Receipt = v }),
	statemodel.NewAxis("drift", []Drift{DriftNone, Drifted}, func(s *State, v Drift) { s.Drift = v }),
}

// State reduces the package to its axes as of now.
func (p Package) State(now time.Time) State {
	st := State{
		Source: p.Source, Timing: Purchased, Credits: CreditsLeft, Price: Priced, Payment: PaymentNone, PaidFor: PaidForCurrent,
		Invoice: slotOf(p.Invoice), Receipt: slotOf(p.Receipt), Drift: DriftNone,
	}
	if p.Drift != "" {
		st.Drift = Drifted
	}
	if p.Payment.Outdated(p.PriceCents) {
		st.PaidFor = PaidForOutdated
	}
	if p.PurchasedAt.After(now) {
		st.Timing = Ahead
	}
	if p.CreditsLeft() == 0 {
		st.Credits = CreditsUsedUp
	}
	if p.PriceCents == 0 {
		st.Price = Free
	}
	switch {
	case p.Payment.IsPaid():
		st.Payment = PaymentPaid
	case p.Payment != nil:
		st.Payment = PaymentWaived
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

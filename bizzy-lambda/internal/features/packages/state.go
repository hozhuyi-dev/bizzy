package packages

import (
	"time"

	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/shared/docref"
)

// State is a package reduced to the independent axes its rules read (see
// rules.go and testdata/states.md).
type State struct {
	Origin  Origin       `json:"origin"`
	Timing  Timing       `json:"timing"`
	Credits Credits      `json:"credits"`
	Price   Price        `json:"price"`
	Invoice DocSlot      `json:"invoice"`
	Receipt DocSlot      `json:"receipt"`
	Payment PaymentState `json:"payment"`
}

type Origin string

const (
	// InSession: bought in a session, collected with it.
	InSession Origin = "in-session"
	OnItsOwn  Origin = "on-its-own"
)

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
	// CreditsOverdrawn: more sessions use it than it has.
	CreditsOverdrawn Credits = "overdrawn"
)

type Price string

const (
	Free   Price = "free"
	Priced Price = "priced"
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

var Axes = statemodel.Axes[State]{
	statemodel.NewAxis("origin", []Origin{InSession, OnItsOwn}, func(s *State, v Origin) { s.Origin = v }),
	statemodel.NewAxis("timing", []Timing{Ahead, Purchased}, func(s *State, v Timing) { s.Timing = v }),
	statemodel.NewAxis("credits", []Credits{CreditsLeft, CreditsUsedUp, CreditsOverdrawn}, func(s *State, v Credits) { s.Credits = v }),
	statemodel.NewAxis("price", []Price{Free, Priced}, func(s *State, v Price) { s.Price = v }),
	statemodel.NewAxis("invoice", []DocSlot{SlotEmpty, SlotDraft, SlotIssued}, func(s *State, v DocSlot) { s.Invoice = v }),
	statemodel.NewAxis("receipt", []DocSlot{SlotEmpty, SlotDraft, SlotIssued}, func(s *State, v DocSlot) { s.Receipt = v }),
	statemodel.NewAxis("payment", []PaymentState{PaymentNone, PaymentPaid}, func(s *State, v PaymentState) { s.Payment = v }),
}

// State reduces the package to its axes as of now.
func (p Package) State(now time.Time) State {
	st := State{
		Origin: OnItsOwn, Timing: Purchased, Credits: CreditsLeft, Price: Priced,
		Invoice: slotOf(p.Invoice), Receipt: slotOf(p.Receipt), Payment: PaymentNone,
	}
	if p.BoughtIn != "" {
		st.Origin = InSession
	}
	if p.PurchasedAt.After(now) {
		st.Timing = Ahead
	}
	switch {
	case p.CreditsUsed > p.Sessions:
		st.Credits = CreditsOverdrawn
	case p.CreditsUsed == p.Sessions:
		st.Credits = CreditsUsedUp
	}
	if p.PriceCents == 0 {
		st.Price = Free
	}
	if p.Paid != nil {
		st.Payment = PaymentPaid
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

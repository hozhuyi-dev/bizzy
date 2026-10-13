package clients

import (
	"slices"

	"bizzy-lambda/internal/platform/statemodel"
)

// State is a client reduced to the independent axes its rules read (see
// testdata/states.md).
type State struct {
	Contact    ContactLink
	DefaultFee DefaultFee
	OwnAlias   OwnAlias
}

type ContactLink string

const (
	ContactLinked ContactLink = "linked"
	// ContactMissing: the Google contact was deleted or merged; the copy is
	// kept so it can be recreated.
	ContactMissing ContactLink = "missing"
	ContactNone    ContactLink = "none"
)

type DefaultFee string

const (
	DefaultFeeSet  DefaultFee = "set"
	DefaultFeeNone DefaultFee = "none"
)

// OwnAlias says whether the client's own name is one of its aliases.
type OwnAlias string

const (
	OwnAliasYes OwnAlias = "yes"
	OwnAliasNo  OwnAlias = "no"
)

var Axes = statemodel.Axes[State]{
	statemodel.NewAxis("contact", []ContactLink{ContactLinked, ContactMissing, ContactNone}, func(s *State, v ContactLink) { s.Contact = v }),
	statemodel.NewAxis("default fee", []DefaultFee{DefaultFeeSet, DefaultFeeNone}, func(s *State, v DefaultFee) { s.DefaultFee = v }),
	statemodel.NewAxis("own name an alias", []OwnAlias{OwnAliasYes, OwnAliasNo}, func(s *State, v OwnAlias) { s.OwnAlias = v }),
}

// State reduces the client to its axes.
func (c Client) State() State {
	st := State{Contact: ContactLinked, DefaultFee: DefaultFeeSet, OwnAlias: OwnAliasYes}
	switch {
	case c.Contact == nil:
		st.Contact = ContactNone
	case c.Contact.Missing:
		st.Contact = ContactMissing
	}
	if c.DefaultFeeCents == nil {
		st.DefaultFee = DefaultFeeNone
	}
	if !slices.Contains(c.Aliases, NormalizeAlias(c.Name)) {
		st.OwnAlias = OwnAliasNo
	}
	return st
}

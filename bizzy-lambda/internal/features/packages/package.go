// Package packages is prepaid hours. A package is bought on its own in the
// app, or in a session (its title says `10x85`: 10 hours at 85, and it is
// collected with that session). Its price is its invoice line (see
// documents), billed to whoever pays for it. Its credits are for its
// client and those it is shared with (a family), each an hour, given to
// their sessions half an hour at a time when they are booked (see
// sessions), so how much is used is counted from the sessions, which this
// package can't see: the app passes that in (Usage).
package packages

import (
	"fmt"
	"slices"
	"strconv"
	"time"

	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/txn"
)

type Package struct {
	ID       string `json:"id"`
	ClientID string `json:"clientId"`
	// SharedWith are the other clients whose sessions its credits may pay
	// for, copied from its client's SharesWith when it is bought.
	SharedWith []string `json:"sharedWith,omitempty"`
	// Hours are its credits, an hour each.
	Hours       int       `json:"hours"`
	PurchasedAt time.Time `json:"purchasedAt"`
	// BoughtIn is the session it was bought in, whose title shows it; ""
	// for one bought on its own.
	BoughtIn  string    `json:"boughtIn,omitempty"`
	Note      string    `json:"note,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// Packages are filed by client and purchase, and by the session they were
// bought in.
var Packages = txn.Kind[Package]{
	Name: "PACKAGE", Gone: "This package was deleted.",
	Doc: txn.Doc{What: "A prepaid package of hours, and whom it is shared with; its price is its invoice line.", Client: "its client, by purchase", Time: "when it was bought", Ref: "the session it was bought in"},
	Meta: func(p *Package) txn.Meta {
		return txn.Meta{ID: p.ID, Client: p.ClientID, Time: p.PurchasedAt, Ref: p.BoughtIn}
	},
	Whole: true,
}

// Reason is why a package is on the to-do list.
type Reason string

// ReasonCollect: bought on its own, and not paid. One bought in a session
// is collected with that session.
const ReasonCollect Reason = "collect"

// Todo is what is left to do on the package, owing owedCents, as of now.
func (p Package) Todo(owedCents int64, now time.Time) []Reason {
	out := []Reason{}
	if p.BoughtIn == "" && owedCents > 0 && !p.PurchasedAt.After(now) {
		out = append(out, ReasonCollect)
	}
	return out
}

// Clients are whom its credits are for: its client, then those it is
// shared with.
func (p Package) Clients() []string {
	return append([]string{p.ClientID}, p.SharedWith...)
}

// UsableBy reports whether its credits may pay for a client's sessions.
func (p Package) UsableBy(clientID string) bool {
	return slices.Contains(p.Clients(), clientID)
}

// Used is how many minutes of a package's credits each client's sessions
// use.
type Used map[string]int

// Minutes is how many minutes of its credits sessions use in all.
func (u Used) Minutes() int {
	total := 0
	for _, m := range u {
		total += m
	}
	return total
}

// Usage is how many minutes of a package's credits sessions use, by
// client: counted by sessions, which own them (see sessions.CreditsUsed).
type Usage func(tx *txn.Tx, packageID string) (Used, error)

// SharedWith reports whether any package is shared with a client (see
// clients.Owner).
func SharedWith(tx *txn.Tx, clientID string) (bool, error) {
	all, err := Packages.All(tx)
	return slices.ContainsFunc(all, func(p *Package) bool { return slices.Contains(p.SharedWith, clientID) }), err
}

// BoughtIn is the package bought in a session; nil when none.
func BoughtIn(tx *txn.Tx, sessionID string) (*Package, error) {
	all, err := Packages.WithRef(tx, sessionID)
	if err != nil || len(all) == 0 {
		return nil, err
	}
	return all[0], nil
}

// Description is how a package's line, on its invoice and its receipt,
// describes it: by its sessions, as clients count them, a credit an hour
// each ("Physiotherapy package (10 sessions)").
func Description(cfg settings.Settings, hours int) string {
	sessions := "sessions"
	if hours == 1 {
		sessions = "session"
	}
	return fmt.Sprintf("%s package (%d %s)", cfg.ServiceName, hours, sessions)
}

// Hours writes minutes as hours: "1.5 h".
func Hours(minutes int) string {
	return strconv.FormatFloat(float64(minutes)/60, 'f', -1, 64) + " h"
}

// ShareCents is the value of minutes of its credits, from minute from of
// them on: the price split by time, rounded so the shares of all its
// minutes add up to the price exactly.
func (p Package) ShareCents(priceCents int64, from, minutes int) int64 {
	total := int64(p.Hours) * 60
	if total == 0 {
		return 0
	}
	upTo := func(m int) int64 { return priceCents * min(int64(m), total) / total }
	return upTo(from+minutes) - upTo(from)
}

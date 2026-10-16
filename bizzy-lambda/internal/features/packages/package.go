// Package packages is prepaid bundles of sessions. A package is bought on
// its own in the app, or in a session (its title says `10x85`, and it is
// collected with that session). Its price is its invoice line (see
// documents); each credit is given to a session when the session is
// booked (see sessions), so how many are used is counted from the
// sessions, which this package can't see: the app passes that in (Usage).
package packages

import (
	"fmt"
	"time"

	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/txn"
)

type Package struct {
	ID          string    `json:"id"`
	ClientID    string    `json:"clientId"`
	Sessions    int       `json:"sessions"`
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
	Doc: txn.Doc{What: "A prepaid package of sessions; its price is its invoice line.", Client: "its client, by purchase", Time: "when it was bought", Ref: "the session it was bought in"},
	Meta: func(p *Package) txn.Meta {
		return txn.Meta{ID: p.ID, Client: p.ClientID, Time: p.PurchasedAt, Ref: p.BoughtIn}
	},
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

// Usage is how many sessions use a package's credits: counted by
// sessions, which own them (see sessions.CreditsUsed).
type Usage func(tx *txn.Tx, packageID string) (int, error)

// BoughtIn is the package bought in a session; nil when none.
func BoughtIn(tx *txn.Tx, sessionID string) (*Package, error) {
	all, err := Packages.WithRef(tx, sessionID)
	if err != nil || len(all) == 0 {
		return nil, err
	}
	return all[0], nil
}

// Description is how a package's line describes it.
func Description(cfg settings.Settings, sessions int) string {
	return fmt.Sprintf("%s package (%d sessions)", cfg.ServiceName, sessions)
}

// ShareCents is the value of credit i (0-based): the price split evenly,
// the leftover cents on the first credits so the shares add up exactly.
func (p Package) ShareCents(priceCents int64, i int) int64 {
	if p.Sessions < 1 {
		return 0
	}
	n := int64(p.Sessions)
	share := priceCents / n
	if int64(i) < priceCents%n {
		share++
	}
	return share
}

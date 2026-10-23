// Package packages is prepaid hours. A package is bought on its own in the
// app, or in a session (its title says `10x85`: 10 hours at 85, and it is
// collected with that session). Its price is its invoice line (see
// documents). Each credit is an hour, given to sessions half an hour at a
// time when they are booked (see sessions), so how much is used is
// counted from the sessions, which this package can't see: the app passes
// that in (Usage).
package packages

import (
	"fmt"
	"strconv"
	"time"

	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/txn"
)

type Package struct {
	ID       string `json:"id"`
	ClientID string `json:"clientId"`
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
	Doc: txn.Doc{What: "A prepaid package of hours; its price is its invoice line.", Client: "its client, by purchase", Time: "when it was bought", Ref: "the session it was bought in"},
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

// Usage is how many minutes of a package's credits sessions use: counted
// by sessions, which own them (see sessions.CreditsUsed).
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
func Description(cfg settings.Settings, hours int) string {
	return fmt.Sprintf("%s package (%s)", cfg.ServiceName, Hours(hours*60))
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

package clients

import (
	"strings"
	"time"
)

// Client is written by several parties, each owning its own fields (see the
// repository): the app (profile), the billing reconcile (Activity,
// LastSessionAt, NextBookedAt), the contacts sync (refreshing Contact) and
// Reconnect (LastContactedAt).
type Client struct {
	ID string `json:"id" dynamodbav:"id"`
	// Name is hers to choose; the Google contact may be named differently.
	Name string `json:"name" dynamodbav:"name"`
	// Contact links the client to a Google contact, where her contact
	// details live. Every client gets one when created; it is nil only if
	// the link was never made.
	Contact *Contact `json:"contact,omitempty" dynamodbav:"contact,omitempty"`
	// Aliases are the names she writes in the calendar for this client. The
	// client's own name is always one of them.
	Aliases []string `json:"aliases" dynamodbav:"aliases"`
	// FeeRates are the client's fees over time, oldest first, charged when a
	// session title has no amount and the client has no package credit left
	// (see FeeOn). A new fee from a date leaves the sessions before it alone,
	// so changing it never reprices what was already charged.
	FeeRates []FeeRate `json:"feeRates,omitempty" dynamodbav:"feeRates,omitempty"`
	// HomeVisits makes her sessions with this client home visits unless their
	// title says (H) (see calendar.Places).
	HomeVisits bool `json:"homeVisits,omitempty" dynamodbav:"homeVisits,omitempty"`

	// Activity is keyed by month ("2026-10") in her time zone. Business
	// metrics and follow-ups are summed from it in the browser.
	Activity      map[string]MonthActivity `json:"activity,omitempty" dynamodbav:"activity,omitempty"`
	LastSessionAt *time.Time               `json:"lastSessionAt,omitempty" dynamodbav:"lastSessionAt,omitempty"`
	// NextBookedAt is the next future calendar entry with this client.
	NextBookedAt    *time.Time `json:"nextBookedAt,omitempty" dynamodbav:"nextBookedAt,omitempty"`
	LastContactedAt *time.Time `json:"lastContactedAt,omitempty" dynamodbav:"lastContactedAt,omitempty"`
}

// FeeRate is one fee and the day it starts.
type FeeRate struct {
	// From is the first local day (YYYY-MM-DD) it applies; empty for the
	// first rate, which also covers every session before the next one.
	From  string `json:"from,omitempty" dynamodbav:"from,omitempty"`
	Cents int64  `json:"cents" dynamodbav:"cents"`
}

// FeeOn is the fee for a session on a local day (YYYY-MM-DD): the last rate
// starting on or before it. Nil when no fee is set.
func (c Client) FeeOn(day string) *int64 {
	var fee *int64
	for _, r := range c.FeeRates {
		if r.From > day {
			break
		}
		fee = &r.Cents
	}
	return fee
}

// Contact is the linked Google contact with a read-only copy of the details
// bizzy uses. Google is the source of truth: edits in the app go straight to
// Google, and every sync refreshes the copy.
type Contact struct {
	// ResourceName is the contact's id in the People API ("people/c123").
	ResourceName string `json:"resourceName" dynamodbav:"resourceName"`
	// ETag is the contact's version when copied; an edit made against an
	// older one is rejected rather than overwriting a change from her phone.
	ETag        string `json:"etag,omitempty" dynamodbav:"etag,omitempty"`
	DisplayName string `json:"displayName,omitempty" dynamodbav:"displayName,omitempty"`
	Email       string `json:"email,omitempty" dynamodbav:"email,omitempty"`
	Phone       string `json:"phone,omitempty" dynamodbav:"phone,omitempty"`
	// Address is printed on receipts; Postcode is kept apart so clients can
	// be grouped by area.
	Address  string `json:"address,omitempty" dynamodbav:"address,omitempty"`
	Postcode string `json:"postcode,omitempty" dynamodbav:"postcode,omitempty"`
	// Missing is set when the sync no longer finds the contact in Google:
	// deleted, or merged into another. The copy above is kept so the
	// contact can be recreated from it.
	Missing  bool      `json:"missing,omitempty" dynamodbav:"missing,omitempty"`
	SyncedAt time.Time `json:"syncedAt" dynamodbav:"syncedAt"`
}

// SameDetails reports whether two copies say the same thing, ignoring when
// they were taken.
func (c Contact) SameDetails(other Contact) bool {
	c.SyncedAt, other.SyncedAt = time.Time{}, time.Time{}
	return c == other
}

// MonthActivity sums one client's sessions in a month.
type MonthActivity struct {
	Sessions     int `json:"sessions" dynamodbav:"sessions"`
	HomeSessions int `json:"homeSessions,omitempty" dynamodbav:"homeSessions,omitempty"`
	// ReceivedCents is money paid that month: payments she recorded on
	// sessions, packages bought in the app, and fees from before tracking.
	ReceivedCents int64 `json:"receivedCents" dynamodbav:"receivedCents"`
	// EarnedCents values sessions as they happen; a package session counts
	// as its share of the package price.
	EarnedCents     int64 `json:"earnedCents" dynamodbav:"earnedCents"`
	HomeEarnedCents int64 `json:"homeEarnedCents,omitempty" dynamodbav:"homeEarnedCents,omitempty"`
}

// NormalizeAlias lower-cases a name and collapses its whitespace, so aliases
// compare equal however she happened to type them.
func NormalizeAlias(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(name), " "))
}

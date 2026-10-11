package clients

import (
	"strings"
	"time"
)

// Client is written by several parties, each owning its own fields (see the
// repository): the app (profile), the billing reconcile (Activity,
// LastSessionAt), the calendar sync (NextBookedAt) and her follow-ups.
type Client struct {
	ID    string `json:"id" dynamodbav:"id"`
	Name  string `json:"name" dynamodbav:"name"`
	Email string `json:"email,omitempty" dynamodbav:"email,omitempty"`
	Phone string `json:"phone,omitempty" dynamodbav:"phone,omitempty"`
	// Address is printed on receipts; Postcode is kept apart so clients can
	// be grouped by area.
	Address  string `json:"address,omitempty" dynamodbav:"address,omitempty"`
	Postcode string `json:"postcode,omitempty" dynamodbav:"postcode,omitempty"`
	// Aliases are the names she writes in the calendar for this client. The
	// client's own name is always one of them.
	Aliases []string `json:"aliases" dynamodbav:"aliases"`
	// DefaultFeeCents is charged when a session title has no amount and the
	// client has no package credit left.
	DefaultFeeCents *int64 `json:"defaultFeeCents,omitempty" dynamodbav:"defaultFeeCents,omitempty"`
	// HomeVisits makes her sessions with this client home visits unless the
	// event's colour says otherwise.
	HomeVisits bool `json:"homeVisits,omitempty" dynamodbav:"homeVisits,omitempty"`

	// Activity is keyed by month ("2026-10") in her time zone. Business
	// metrics and follow-ups are summed from it in the browser.
	Activity      map[string]MonthActivity `json:"activity,omitempty" dynamodbav:"activity,omitempty"`
	LastSessionAt *time.Time               `json:"lastSessionAt,omitempty" dynamodbav:"lastSessionAt,omitempty"`
	// NextBookedAt is the next future calendar entry with this client.
	NextBookedAt    *time.Time `json:"nextBookedAt,omitempty" dynamodbav:"nextBookedAt,omitempty"`
	LastContactedAt *time.Time `json:"lastContactedAt,omitempty" dynamodbav:"lastContactedAt,omitempty"`
}

// MonthActivity sums one client's sessions in a month.
type MonthActivity struct {
	Sessions     int `json:"sessions" dynamodbav:"sessions"`
	HomeSessions int `json:"homeSessions,omitempty" dynamodbav:"homeSessions,omitempty"`
	// ReceivedCents is money paid that month: session fees, and packages in
	// the month they were bought.
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

package clients

import "strings"

type Client struct {
	ID    string `json:"id" dynamodbav:"id"`
	Name  string `json:"name" dynamodbav:"name"`
	Email string `json:"email,omitempty" dynamodbav:"email,omitempty"`
	// Aliases are the names she writes in the calendar for this client. The
	// client's own name is always one of them.
	Aliases []string `json:"aliases" dynamodbav:"aliases"`
	// DefaultFeeCents is charged when a session title has no amount and the
	// client has no package credit left.
	DefaultFeeCents *int64 `json:"defaultFeeCents,omitempty" dynamodbav:"defaultFeeCents,omitempty"`
}

// NormalizeAlias lower-cases a name and collapses its whitespace, so aliases
// compare equal however she happened to type them.
func NormalizeAlias(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(name), " "))
}

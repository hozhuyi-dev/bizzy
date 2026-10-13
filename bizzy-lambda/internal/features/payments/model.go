// Package payments records what she was paid: a session's fee, a package,
// or both at once (a session and the package its title bought), written
// together so one is never paid without the other.
package payments

type Kind string

const (
	KindSession Kind = "session"
	KindPackage Kind = "package"
)

// Item is one thing paid for.
type Item struct {
	Kind Kind   `json:"kind"`
	ID   string `json:"id"`
	// AmountCents defaults to what it costs: the session's fee, or the
	// package's price.
	AmountCents int64 `json:"amountCents"`
}

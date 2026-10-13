// Package statemodel is how bizzy reasons about the state of its entities.
//
// Each entity reduces itself to a State: a few independent axes, each a
// small enum (see Axis). A table of Rules over that State says which
// combinations need the user, which contradict the outside world, and which
// must never happen. The app's to-do list is derived from those rules, the
// tests enumerate every combination of the axes into a reviewable decision
// table (see Table), and the simulation (internal/simulation) checks after
// every action that no Impossible rule holds.
//
// The package knows nothing about bizzy's entities: each feature declares
// its own axes and rules in its state.go and rules.go.
package statemodel

// Bucket is what a combination of axes means.
type Bucket string

const (
	// Quiet is valid with nothing to do: no rule fires.
	Quiet Bucket = "quiet"
	// NeedsAction is valid but incomplete: it goes on the to-do list until
	// one of the rule's ResolvedBy actions completes it.
	NeedsAction Bucket = "needs-action"
	// Contradiction is reachable because something outside the app (the
	// calendar, Google Contacts) changed underneath it. The app can't stop
	// it, only detect it: it goes on the to-do list to be fixed.
	Contradiction Bucket = "contradiction"
	// Impossible must never happen. A guard on each GuardedBy action keeps
	// it from happening, or it can't by construction.
	Impossible Bucket = "impossible"
)

// severity orders buckets, for the one a combination falls in when several
// rules fire.
func (b Bucket) severity() int {
	switch b {
	case NeedsAction:
		return 1
	case Contradiction:
		return 2
	case Impossible:
		return 3
	default:
		return 0
	}
}

// Worse returns the more severe of two buckets.
func Worse(a, b Bucket) Bucket {
	if b.severity() > a.severity() {
		return b
	}
	return a
}

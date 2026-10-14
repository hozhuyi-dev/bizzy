package integrity

import (
	"cmp"
	"encoding/json"
	"fmt"
	"maps"
	"slices"

	"bizzy-lambda/internal/features/book"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/expenses"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/statemodel"
)

// Violation is one thing that must never happen, and does.
type Violation struct {
	Rule   string
	Detail string
	// Pending is the suggested resolution of a known gap (see Rule.Pending).
	Pending string
	// Tolerated says what puts it right later (see Rule.Tolerated).
	Tolerated string
}

func (v Violation) String() string { return v.Rule + ": " + v.Detail }

// Check returns every violation in the world: of each entity's Impossible
// rules, the book's invariants, and the Links, known gaps (Pending)
// included. Nil means all is well.
func Check(w World) []Violation {
	var out []Violation
	for _, id := range sortedKeys(w.Sessions) {
		out = append(out, entity("session", id, sessions.Rules, w.Sessions[id].State(w.Now))...)
	}
	for _, id := range sortedKeys(w.Packages) {
		out = append(out, entity("package", id, packages.Rules, w.Packages[id].State(w.Now))...)
	}
	for _, id := range sortedKeys(w.FollowUps) {
		out = append(out, entity("follow-up", id, followups.Rules, w.FollowUps[id].State())...)
	}
	for _, id := range sortedKeys(w.Documents) {
		out = append(out, entity("document", id, documents.Rules, w.Documents[id].State())...)
	}
	for _, id := range sortedKeys(w.Clients) {
		out = append(out, entity("client", id, clients.Rules, w.Clients[id].State())...)
	}
	for _, id := range sortedKeys(w.Expenses) {
		out = append(out, entity("expense", id, expenses.Rules, w.Expenses[id].State())...)
	}
	for _, id := range sortedKeys(w.Conflicts) {
		out = append(out, entity("conflict", id, conflicts.Rules, w.Conflicts[id].State())...)
	}
	b := w.Book()
	for _, inv := range book.Invariants {
		for _, detail := range inv.Broken(b) {
			out = append(out, Violation{Rule: inv.ID, Detail: detail})
		}
	}
	for _, r := range AllLinks() {
		for _, detail := range r.Broken(w) {
			out = append(out, Violation{Rule: r.ID, Detail: detail, Pending: r.Pending, Tolerated: r.Tolerated})
		}
	}
	return out
}

// AllLinks are the rules between entities the books can't see.
func AllLinks() []Rule {
	return slices.Concat(Links, FileLinks, ExpenseLinks)
}

func entity[S any](kind, id string, rules statemodel.Rules[S], s S) []Violation {
	var out []Violation
	for _, r := range rules.Violations(s) {
		out = append(out, Violation{Rule: r.ID, Detail: fmt.Sprintf("%s %s: %s", kind, id, r.Why)})
	}
	return out
}

// Actions lists every action the rules name, across the entities and the
// links, for checking each exists.
func Actions() []string {
	all := slices.Concat(sessions.Rules.Actions(), packages.Rules.Actions(), followups.Rules.Actions(),
		documents.Rules.Actions(), clients.Rules.Actions(), expenses.Rules.Actions(), conflicts.Rules.Actions())
	for _, r := range AllLinks() {
		all = append(all, r.GuardedBy...)
	}
	for _, g := range book.Guards {
		all = append(all, g.Remedies...)
	}
	slices.Sort(all)
	return slices.Compact(all)
}

func (w World) documents() []documents.Document {
	var out []documents.Document
	for _, id := range sortedKeys(w.Documents) {
		out = append(out, w.Documents[id])
	}
	return out
}

func sortedKeys[K cmp.Ordered, V any](m map[K]V) []K {
	return slices.Sorted(maps.Keys(m))
}

func sameJSON(a, b any) bool {
	x, errX := json.Marshal(a)
	y, errY := json.Marshal(b)
	return errX == nil && errY == nil && string(x) == string(y)
}

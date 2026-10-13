package integrity

import (
	"cmp"
	"fmt"
	"maps"
	"slices"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/shared/docref"
)

// Violation is one thing that must never happen, and does.
type Violation struct {
	Rule   string
	Detail string
	// Pending is the suggested resolution of a known gap (see Rule.Pending).
	Pending string
}

func (v Violation) String() string { return v.Rule + ": " + v.Detail }

// Check returns every violation in the world: of each entity's Impossible
// rules, and of the Links between them, known gaps (Pending) included. Nil
// means all is well.
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
	for _, r := range Links {
		for _, detail := range r.Broken(w) {
			out = append(out, Violation{Rule: r.ID, Detail: detail, Pending: r.Pending})
		}
	}
	return out
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
		documents.Rules.Actions(), clients.Rules.Actions())
	for _, r := range Links {
		all = append(all, r.GuardedBy...)
	}
	slices.Sort(all)
	return slices.Compact(all)
}

// item is a session or package as a document source.
type item struct {
	src      documents.Source
	clientID string
	slots    map[docref.Slot]*docref.Ref
}

func (it item) ref(slot docref.Slot) *docref.Ref { return it.slots[slot] }

func (w World) item(src documents.Source) (item, bool) {
	if src.Kind == documents.SourcePackage {
		p, ok := w.Packages[src.ID]
		return item{src: src, clientID: p.ClientID, slots: map[docref.Slot]*docref.Ref{docref.SlotInvoice: p.Invoice, docref.SlotReceipt: p.Receipt}}, ok
	}
	s, ok := w.Sessions[src.ID]
	return item{src: src, clientID: s.ClientID, slots: map[docref.Slot]*docref.Ref{docref.SlotInvoice: s.Invoice, docref.SlotReceipt: s.Receipt}}, ok
}

// items are every session and package, in a stable order.
func (w World) items() []item {
	var out []item
	for _, id := range sortedKeys(w.Sessions) {
		it, _ := w.item(documents.Source{Kind: documents.SourceSession, ID: id})
		out = append(out, it)
	}
	for _, id := range sortedKeys(w.Packages) {
		it, _ := w.item(documents.Source{Kind: documents.SourcePackage, ID: id})
		out = append(out, it)
	}
	return out
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

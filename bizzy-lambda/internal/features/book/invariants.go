package book

import (
	"fmt"
	"slices"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/statemodel"
)

// Invariant is something every book must say: an entity's impossible rules
// are its own (rules.go in each feature), these hold across them. Check
// runs every one before each commit, so nothing breaking one is ever
// written, and the simulation runs them over everything stored after every
// step (internal/integrity).
type Invariant struct {
	ID  string
	Why string
	// Broken lists what breaks it, one entry each, in a stable order.
	Broken func(b *Book) []string
}

// Invariants are the rules across sessions, packages, documents and
// follow-ups. The guards name the ones each keeps (Protects).
var Invariants = []Invariant{
	{
		ID: "sessions-never-overlap", Why: "No two sessions overlap, whoever's they are: she sees one client at a time",
		Broken: func(b *Book) []string {
			var out []string
			for _, id := range SortedIDs(b.Sessions) {
				s := b.Sessions[id]
				if o, ok := b.overlapping(s); ok && (b.Sessions[o.ID] == nil || o.ID > id) {
					out = append(out, fmt.Sprintf("session %s overlaps session %s", id, o.ID))
				}
			}
			return out
		},
	},
	{
		ID: "follow-ups-are-a-clients", Why: "A follow-up is for one of her clients, and about a session of theirs if any",
		Broken: func(b *Book) []string {
			var out []string
			for _, id := range SortedIDs(b.FollowUps) {
				f := b.FollowUps[id]
				if _, ok := b.Clients[f.ClientID]; !ok {
					out = append(out, fmt.Sprintf("follow-up %s is for %q, who isn't a client", id, f.ClientID))
				}
				if s, ok := b.Sessions[f.SessionID]; f.SessionID != "" && !ok && b.Loaded[f.ClientID] {
					out = append(out, fmt.Sprintf("follow-up %s is about session %s, which doesn't exist", id, f.SessionID))
				} else if ok && s.ClientID != f.ClientID {
					out = append(out, fmt.Sprintf("follow-up %s for %s is about %s's session %s", id, f.ClientID, s.ClientID, s.ID))
				}
			}
			return out
		},
	},
	{
		ID: "lines-cover-what-exists", Why: "Every line of a live document covers a session or package of its client",
		Broken: func(b *Book) []string {
			var out []string
			for _, id := range SortedIDs(b.Docs) {
				d := b.Docs[id]
				for _, src := range d.Sources {
					owner, ok := b.owner(src)
					switch {
					case !ok && b.Loaded[d.ClientID]:
						out = append(out, fmt.Sprintf("%s %s covers %s %s, which doesn't exist", d.Type, d.ID, src.Kind, src.ID))
					case ok && owner != d.ClientID:
						out = append(out, fmt.Sprintf("%s %s for %s covers %s %s of %s", d.Type, d.ID, d.ClientID, src.Kind, src.ID, owner))
					}
				}
			}
			return out
		},
	},
	{
		ID: "one-live-document-of-each-type", Why: "A session or package is on at most one live invoice and one live receipt, once",
		Broken: func(b *Book) []string {
			var out []string
			for _, src := range b.items() {
				for _, docType := range []documents.Type{documents.TypeInvoice, documents.TypeReceipt} {
					if n := len(b.lines(src, docType)); n > 1 {
						out = append(out, fmt.Sprintf("%s %s is on %d %ss", src.Kind, src.ID, n, docType))
					}
				}
			}
			return out
		},
	},
	{
		ID: "invoiced", Why: "A package, and a session no credit covers, is on an invoice",
		Broken: func(b *Book) []string {
			var out []string
			for _, src := range b.items() {
				if b.needsInvoice(src) && !b.invoiced(src) {
					out = append(out, fmt.Sprintf("%s %s is on no invoice", src.Kind, src.ID))
				}
			}
			return out
		},
	},
	{
		ID: "paid-in-full", Why: "What was received for something is what its invoice charges",
		Broken: func(b *Book) []string {
			var out []string
			for _, src := range b.items() {
				if paid, fee := b.paidFor(src); b.isPaid(src) && paid != fee {
					out = append(out, fmt.Sprintf("%s %s: %d received, %d charged", src.Kind, src.ID, paid, fee))
				}
			}
			return out
		},
	},
	{
		ID: "credits-of-own-package", Why: "A credit covers a session from a package of its own client",
		Broken: func(b *Book) []string {
			var out []string
			for _, id := range SortedIDs(b.Sessions) {
				s := b.Sessions[id]
				if !s.OnCredit() {
					continue
				}
				if p, ok := b.Packages[s.PackageID]; !ok && b.Loaded[s.ClientID] {
					out = append(out, fmt.Sprintf("session %s uses a credit of %s, which doesn't exist", id, s.PackageID))
				} else if ok && p.ClientID != s.ClientID {
					out = append(out, fmt.Sprintf("session %s of %s uses a credit of %s's package %s", id, s.ClientID, p.ClientID, p.ID))
				}
			}
			return out
		},
	},
	{
		ID: "bought-in-its-session", Why: "A package bought in a session and the session say so of each other, for the same client and day",
		Broken: func(b *Book) []string {
			var out []string
			for _, id := range SortedIDs(b.Packages) {
				p := b.Packages[id]
				if p.BoughtIn == "" {
					continue
				}
				s, ok := b.Sessions[p.BoughtIn]
				switch {
				case !ok:
					out = append(out, fmt.Sprintf("package %s was bought in session %s, which doesn't exist", id, p.BoughtIn))
				case s.BoughtPackageID != id:
					out = append(out, fmt.Sprintf("package %s was bought in session %s, which says it bought %q", id, s.ID, s.BoughtPackageID))
				case s.ClientID != p.ClientID || !s.Start.Equal(p.PurchasedAt):
					out = append(out, fmt.Sprintf("package %s isn't its session %s's client or day", id, s.ID))
				}
			}
			for _, id := range SortedIDs(b.Sessions) {
				s := b.Sessions[id]
				if p, ok := b.Packages[s.BoughtPackageID]; s.BoughtPackageID != "" && (!ok || p.BoughtIn != id) {
					out = append(out, fmt.Sprintf("session %s says it bought package %s, which doesn't say so", id, s.BoughtPackageID))
				}
			}
			return out
		},
	},
	{
		ID: "copies-are-current", Why: "What an item copies from its documents and sessions is what they say now",
		Broken: func(b *Book) []string {
			derived := b.Clone()
			derived.Derive()
			var out []string
			for _, id := range SortedIDs(b.Sessions) {
				if !sameJSON(b.Sessions[id], derived.Sessions[id]) {
					out = append(out, "session "+id+" is out of date")
				}
			}
			for _, id := range SortedIDs(b.Packages) {
				if !sameJSON(b.Packages[id], derived.Packages[id]) {
					out = append(out, "package "+id+" is out of date")
				}
			}
			for _, id := range SortedIDs(b.Docs) {
				if !sameJSON(b.Docs[id], derived.Docs[id]) {
					out = append(out, "document "+id+" is out of date")
				}
			}
			for _, id := range SortedIDs(b.FollowUps) {
				if !sameJSON(b.FollowUps[id], derived.FollowUps[id]) {
					out = append(out, "follow-up "+id+" is out of date")
				}
			}
			return out
		},
	},
}

// The invariants the guards keep but no single rule table states: whatever
// an issued document says, it keeps saying (checked on transitions, see
// the issued-documents-never-change guard).
const issuedNeverChange = "issued-documents-never-change"

// InvariantIDs are the ids a guard may protect: the entity rules' and
// these.
func InvariantIDs() []string {
	ids := []string{issuedNeverChange}
	for _, r := range sessions.Rules {
		ids = append(ids, r.ID)
	}
	for _, r := range packages.Rules {
		ids = append(ids, r.ID)
	}
	for _, r := range documents.Rules {
		ids = append(ids, r.ID)
	}
	for _, r := range followups.Rules {
		ids = append(ids, r.ID)
	}
	for _, inv := range Invariants {
		ids = append(ids, inv.ID)
	}
	slices.Sort(ids)
	return slices.Compact(ids)
}

// Check lists what breaks an invariant or an entity's impossible rule;
// nil when the book is sound.
func (b *Book) Check() []string {
	var out []string
	for _, id := range SortedIDs(b.Sessions) {
		out = append(out, violations("session "+id, sessions.Rules, b.Sessions[id].State(b.Now))...)
	}
	for _, id := range SortedIDs(b.Packages) {
		out = append(out, violations("package "+id, packages.Rules, b.Packages[id].State(b.Now))...)
	}
	for _, id := range SortedIDs(b.Docs) {
		out = append(out, violations("document "+id, documents.Rules, b.Docs[id].State())...)
	}
	for _, id := range SortedIDs(b.FollowUps) {
		out = append(out, violations("follow-up "+id, followups.Rules, b.FollowUps[id].State())...)
	}
	for _, inv := range Invariants {
		for _, detail := range inv.Broken(b) {
			out = append(out, inv.ID+": "+detail)
		}
	}
	return out
}

func violations[S any](what string, rules statemodel.Rules[S], s S) []string {
	var out []string
	for _, r := range rules.Violations(s) {
		out = append(out, r.ID+": "+what)
	}
	return out
}

// owner is the client a session or package belongs to.
func (b *Book) owner(src documents.Source) (string, bool) {
	if src.Kind == documents.SourcePackage {
		p, ok := b.Packages[src.ID]
		if !ok {
			return "", false
		}
		return p.ClientID, true
	}
	s, ok := b.Sessions[src.ID]
	if !ok {
		return "", false
	}
	return s.ClientID, true
}

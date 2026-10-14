package integrity

import (
	"slices"
	"testing"
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/shared/docref"
)

func TestTable(t *testing.T) {
	ids := map[string]bool{}
	for _, r := range AllLinks() {
		if ids[r.ID] {
			t.Errorf("rule %s: duplicate id", r.ID)
		}
		ids[r.ID] = true
		if r.Pending == "" && r.Tolerated == "" && len(r.GuardedBy) == 0 && r.ByConstruction == "" {
			t.Errorf("rule %s: needs GuardedBy, ByConstruction, Tolerated or Pending", r.ID)
		}
	}
	statemodel.Golden(t, "testdata/links.md", Table())
}

// An issued invoice covering two sessions, each copying it: the
// many-to-one link both ways, and what breaks when one side lets go.
func TestLinksBothWays(t *testing.T) {
	now := time.Date(2026, 10, 13, 0, 0, 0, 0, time.UTC)
	rev := 0
	line := func(id, src string) documents.Line {
		return documents.Line{ID: id, Description: "Physio", AmountCents: 9500, Source: &documents.Source{Kind: documents.SourceSession, ID: src}}
	}
	content := documents.Content{Date: "2026-10-12", Lines: []documents.Line{line("l1", "s1"), line("l2", "s2")}, TotalCents: 19000}
	invoice := documents.Document{
		ID: "d1", Type: documents.TypeInvoice, Status: documents.StatusIssued, Number: "INV260001", Revision: &rev,
		ClientID: "jane", ShareToken: "tok", Date: "2026-10-12", TotalCents: 19000, Content: &content,
		Sources: []documents.Source{{Kind: documents.SourceSession, ID: "s1"}, {Kind: documents.SourceSession, ID: "s2"}},
	}
	ref := &docref.Ref{DocumentID: "d1", Number: "INV260001"}
	session := func(id string, hours int) sessions.Session {
		start := now.Add(time.Duration(hours-48) * time.Hour)
		return sessions.Session{ID: id, ClientID: "jane", Start: start, End: start.Add(time.Hour), Location: sessions.LocationOwn,
			FeeCents: 9500, Invoice: ref, Event: calendar.Link{Pending: true}}
	}
	w := World{
		Clients:   map[string]clients.Client{"jane": {ID: "jane", Name: "Jane", Aliases: []string{"jane"}}},
		Sessions:  map[string]sessions.Session{"s1": session("s1", 0), "s2": session("s2", 2)},
		Documents: map[string]documents.Document{"d1": invoice},
		Revisions: []documents.Revision{{DocumentID: "d1", Revision: 0, Number: "INV260001", Content: content}},
		Shares:    map[string]string{"tok": "d1"},
		Now:       now,
	}
	if got := Check(w); len(got) > 0 {
		t.Fatalf("consistent world: %v", got)
	}

	// s2 lets go of the invoice on its side only.
	s := w.Sessions["s2"]
	s.Invoice, s.FeeCents = nil, 0
	w.Sessions["s2"] = s
	var rules []string
	for _, v := range Check(w) {
		rules = append(rules, v.Rule)
	}
	if !slices.Contains(rules, "copies-are-current") {
		t.Errorf("violations = %v, want the session's copy out of date", rules)
	}
}

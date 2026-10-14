package integrity

import (
	"testing"
	"time"

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

// A receipt covering two sessions, each pointing back: the many-to-one link
// both ways.
func TestLinksBothWays(t *testing.T) {
	rev := 0
	receipt := documents.Document{
		ID: "r1", Type: documents.TypeReceipt, Status: documents.StatusIssued, Number: "RCP260001", Revision: &rev,
		ClientID: "jane", ShareToken: "tok",
		Sources: []documents.Source{{Kind: documents.SourceSession, ID: "e1"}, {Kind: documents.SourceSession, ID: "e2"}},
	}
	ref := &docref.Ref{DocumentID: "r1", Number: "RCP260001", ClientID: "jane"}
	w := World{
		Sessions: map[string]sessions.Session{
			"e1": {EventID: "e1", ClientID: "jane", Status: sessions.StatusPriced, Receipt: ref},
			"e2": {EventID: "e2", ClientID: "jane", Status: sessions.StatusPriced, Receipt: ref},
		},
		Documents: map[string]documents.Document{"r1": receipt},
		Revisions: []documents.Revision{{DocumentID: "r1", Revision: 0}},
		Shares:    map[string]string{"tok": "r1"},
		Now:       time.Date(2026, 10, 13, 0, 0, 0, 0, time.UTC),
	}
	for _, v := range linkViolations(w) {
		t.Errorf("consistent world: %v", v)
	}

	// e2 lets go of the receipt on its side only.
	s := w.Sessions["e2"]
	s.Receipt = nil
	w.Sessions["e2"] = s
	got := linkViolations(w)
	if len(got) != 1 || got[0].Rule != "document-sources-point-back" {
		t.Errorf("violations = %v, want the receipt's source not pointing back", got)
	}
}

func linkViolations(w World) []Violation {
	var out []Violation
	for _, v := range Check(w) {
		for _, r := range AllLinks() {
			if r.ID == v.Rule {
				out = append(out, v)
			}
		}
	}
	return out
}

package followups_test

import (
	"context"
	"testing"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/testutil/memory"
)

func TestRematchOnClientSave(t *testing.T) {
	ctx := context.Background()
	m := memory.New()
	due := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	done := due
	m.FollowUpMap = map[string]followups.FollowUp{
		// No client had the name until it became Jane's alias.
		"jj": {EventID: "jj", Title: "! JJ: knee", Due: due, Name: "JJ", Summary: "knee", Problem: "No client has this name", Version: 1},
		// Jane's, under a name she no longer has.
		"old": {EventID: "old", Title: "! Janey: call", Due: due, Name: "Janey", Summary: "call", ClientID: "jane", Version: 1},
		// Done before the alias existed: matched all the same.
		"done": {EventID: "done", Title: "! JJ: older", Due: due, Name: "JJ", Problem: "No client has this name", DoneAt: &done, Version: 1},
	}
	all := []clients.Client{{ID: "jane", Name: "Jane Smith", Aliases: []string{"jane smith", "jj"}}}

	if err := followups.Rematch(ctx, m.FollowUps(), all, "jane"); err != nil {
		t.Fatal(err)
	}
	if f := m.FollowUpMap["jj"]; f.ClientID != "jane" || f.Problem != "" || f.Summary != "knee" {
		t.Errorf("jj = {client %q problem %q summary %q}, want Jane's", f.ClientID, f.Problem, f.Summary)
	}
	if f := m.FollowUpMap["old"]; f.ClientID != "" || f.Problem == "" {
		t.Errorf("old = {client %q problem %q}, want unmatched", f.ClientID, f.Problem)
	}
	if f := m.FollowUpMap["done"]; f.ClientID != "jane" || f.DoneAt == nil {
		t.Errorf("done = {client %q done %v}, want Jane's and still done", f.ClientID, f.DoneAt)
	}

	// Nothing more to change: nothing written.
	writes := m.Writes
	if err := followups.Rematch(ctx, m.FollowUps(), all, "jane"); err != nil {
		t.Fatal(err)
	}
	if m.Writes != writes {
		t.Errorf("rematched again: %d writes", m.Writes-writes)
	}
}

package documents

import (
	"strings"
	"testing"
)

func TestNormalizeRejectsForeignSources(t *testing.T) {
	c := Content{
		Date:      "2026-10-11",
		Recipient: Recipient{Name: "Jane"},
		Lines:     []Line{{Description: "x", AmountCents: 1, Source: &Source{Kind: SourceSession, ID: "other"}}},
	}
	_, err := Normalize(c, map[Source]bool{{Kind: SourceSession, ID: "e1"}: true})
	if err == nil || !strings.Contains(err.Error(), "does not cover") {
		t.Errorf("err = %v", err)
	}
}

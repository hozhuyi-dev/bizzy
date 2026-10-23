package clients

import (
	"strings"
	"testing"
)

func TestIDNo(t *testing.T) {
	for typed, want := range map[string]string{
		"":                 "",
		"  ":               "",
		"900101145678":     "900101-14-5678",
		"900101-14-5678":   "900101-14-5678",
		" 900101 14 5678 ": "900101-14-5678",
		"a1234567":         "A1234567",
		"k 123  456":       "K 123 456",
		"90010114567":      "90010114567", // not a MyKad: kept as typed
	} {
		got, err := IDNo(typed)
		if err != nil || got != want {
			t.Errorf("IDNo(%q) = %q, %v; want %q", typed, got, err, want)
		}
	}
	if _, err := IDNo(strings.Repeat("9", maxIDNo+1)); err == nil {
		t.Error("took an IC or passport number too long to be one")
	}
}

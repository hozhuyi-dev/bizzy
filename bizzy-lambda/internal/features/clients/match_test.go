package clients

import "testing"

func TestMatchName(t *testing.T) {
	aliases := Aliases{
		"jane smith": "c-jane",
		"jane s":     "c-jane",
		"bob lee":    "c-bob",
		"al":         "c-al",
	}

	tests := []struct {
		name     string
		input    string
		kind     MatchKind
		clientID string
	}{
		{name: "exact", input: "Jane Smith", kind: MatchExact, clientID: "c-jane"},
		{name: "case and spacing", input: "  JANE   smith ", kind: MatchExact, clientID: "c-jane"},
		{name: "second alias", input: "jane s", kind: MatchExact, clientID: "c-jane"},
		{name: "transposition", input: "Jnae Smith", kind: MatchNearMiss, clientID: "c-jane"},
		{name: "missing letter", input: "Bob Le", kind: MatchNearMiss, clientID: "c-bob"},
		{name: "short names stay strict", input: "jo", kind: MatchNone},
		{name: "unrelated", input: "Dentist", kind: MatchNone},
		{name: "empty", input: "", kind: MatchNone},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MatchName(tt.input, aliases)
			if got.Kind != tt.kind || got.ClientID != tt.clientID {
				t.Errorf("MatchName(%q) = %+v, want kind %v client %q", tt.input, got, tt.kind, tt.clientID)
			}
		})
	}
}

func TestLevenshtein(t *testing.T) {
	tests := []struct {
		a, b string
		want int
	}{
		{"", "", 0},
		{"abc", "", 3},
		{"kitten", "sitting", 3},
		{"jane", "jnae", 2},
	}

	for _, tt := range tests {
		if got := levenshtein(tt.a, tt.b); got != tt.want {
			t.Errorf("levenshtein(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
		}
	}
}

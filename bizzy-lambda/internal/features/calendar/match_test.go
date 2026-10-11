package calendar

import (
	"slices"
	"testing"
)

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

func TestMatchPeople(t *testing.T) {
	people := PeopleOf([]PersonNames{
		{ResourceName: "people/jane", Full: []string{"Jane Smith-Wong", "Jane Smith"}, Given: "Jane"},
		{ResourceName: "people/jim", Full: []string{"Jim Lee"}, Given: "Jim"},
		{ResourceName: "people/sarah1", Full: []string{"Sarah Lim"}, Given: "Sarah"},
		{ResourceName: "people/sarah2", Full: []string{"Sarah Ong"}, Given: "Sarah"},
		{ResourceName: "people/mum", Full: []string{"Mum"}},
	})

	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{name: "full name", input: "jane smith", want: []string{"people/jane"}},
		{name: "unique given name", input: "Jane", want: []string{"people/jane"}},
		{name: "shared given name", input: "Sarah", want: nil},
		{name: "typo in a long name", input: "Jane Smtih", want: []string{"people/jane"}},
		{name: "short names stay exact", input: "Gym", want: nil},
		{name: "nickname", input: "mum", want: []string{"people/mum"}},
		{name: "unrelated", input: "Dentist appointment", want: nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := MatchPeople(tt.input, people, 3); !slices.Equal(got, tt.want) {
				t.Errorf("MatchPeople(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

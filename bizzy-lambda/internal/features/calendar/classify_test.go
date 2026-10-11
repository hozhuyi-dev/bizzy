package calendar

import "testing"

func TestClassify(t *testing.T) {
	aliases := Aliases{"jane smith": "c-jane"}

	tests := []struct {
		name  string
		event Event
		want  Outcome
	}{
		{name: "known client", event: Event{Title: "Jane Smith"}, want: OutcomeSession},
		{name: "known client tentative", event: Event{Title: "? Jane Smith 95"}, want: OutcomeSession},
		{name: "typo of known client", event: Event{Title: "Jnae Smith"}, want: OutcomeUnmatched},
		{name: "new client with amount", event: Event{Title: "Bob Lee 120"}, want: OutcomeUnmatched},
		{name: "new client with package", event: Event{Title: "Bob Lee 10x85"}, want: OutcomeUnmatched},
		{name: "new client tentative", event: Event{Title: "? Bob Lee"}, want: OutcomeUnmatched},
		{name: "personal event", event: Event{Title: "Pick up kids"}, want: OutcomeSkip},
		{name: "malformed session", event: Event{Title: "Jane Smith 95 100"}, want: OutcomeParseError},
		{name: "all-day event", event: Event{Title: "Jane Smith", AllDay: true}, want: OutcomeSkip},
		{name: "cancelled event", event: Event{Title: "Jane Smith", Cancelled: true}, want: OutcomeSkip},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Classify(tt.event, aliases); got.Outcome != tt.want {
				t.Errorf("Classify(%q) = %v, want %v", tt.event.Title, got.Outcome, tt.want)
			}
		})
	}
}

package googlesync

import "time"

// Summary is what a run found and changed.
type Summary struct {
	// Sessions is how many sessions the window holds.
	Sessions int `json:"sessions"`
	// Session writes this run made.
	Saved   int `json:"saved"`
	Deleted int `json:"deleted"`
	// FollowUps is how many follow-ups it added, changed or removed.
	FollowUps int `json:"followUps"`
	// Contacts is how many clients' contact copies changed.
	Contacts int `json:"contacts"`
}

// Run is the record of the last sync, shown in the app.
type Run struct {
	At      time.Time `json:"at" dynamodbav:"at"`
	Summary Summary   `json:"summary" dynamodbav:"summary"`
	// Error is why the run failed, e.g. Google was disconnected.
	Error string `json:"error,omitempty" dynamodbav:"error,omitempty"`
}

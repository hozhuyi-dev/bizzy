package simulation

import (
	"pgregory.net/rapid"
)

// faultActions make the backend fail a user's action, as a Lambda timeout
// or a lost connection does: it dies before one of its writes (those before
// stay, the rest never happen), or does everything but its answer never
// arrives. Either way she may tap again. Until the next sync repairs it,
// the stores may be half changed; after, nothing may be left impossible,
// and nothing may be stale.
var faultActions = []Action{
	{Name: "fault.crash", Actor: ActorFault, Run: func(t *rapid.T, w *World) {
		i := rapid.IntRange(0, len(userActions)-1).Draw(t, "action")
		// The first write is the router's note of the request (see
		// internal/features/recovery).
		if rapid.IntRange(0, 4).Draw(t, "answer lost?") == 0 {
			w.loseResponse = true
		} else {
			w.crashAt = rapid.IntRange(1, 6).Draw(t, "dies before write")
		}
		w.retry = rapid.Bool().Draw(t, "taps again?")
		defer func() { w.crashAt, w.loseResponse, w.retry = 0, false, false }()
		t.Logf("fault: %s dies before write %d (0: its answer is lost); taps again: %v", userActions[i].Name, w.crashAt, w.retry)
		userActions[i].Run(t, w)
	}},
}

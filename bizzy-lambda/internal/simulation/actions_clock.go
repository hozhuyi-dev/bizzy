package simulation

import (
	"time"

	"pgregory.net/rapid"
)

// clockActions move time on: sessions happen, follow-ups fall due.
var clockActions = []Action{
	{Name: "clock.advance", Actor: ActorClock, Run: func(t *rapid.T, w *World) {
		w.Now = w.Now.Add(time.Duration(rapid.SampledFrom([]int{1, 3, 24, 72}).Draw(t, "hours")) * time.Hour)
		t.Logf("clock: now %s", w.Now.Format(time.RFC3339))
		outsideChange(w)
	}},
}

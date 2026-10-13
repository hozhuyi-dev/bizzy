package simulation

import (
	"time"

	"pgregory.net/rapid"
)

// clockActions move time on: sessions happen, follow-ups fall due, and
// abandoned uploads expire.
var clockActions = []Action{
	{Name: "clock.advance", Actor: ActorClock, Run: func(t *rapid.T, w *World) {
		hours := rapid.SampledFrom([]int{1, 3, 24, 72}).Draw(t, "hours")
		w.Now = w.Now.Add(time.Duration(hours) * time.Hour)
		if hours >= 24 {
			// The bucket expires uploads never confirmed after a day.
			w.Blobs.Expire()
		}
		t.Logf("clock: now %s", w.Now.Format(time.RFC3339))
		outsideChange(w)
	}},
}

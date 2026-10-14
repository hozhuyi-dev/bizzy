package simulation

import (
	"context"
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

// maintenanceActions are the scheduled jobs.
var maintenanceActions = []Action{
	// The quarterly sweep of files no attachment links to.
	{Name: "maintenance.sweep", Actor: ActorMaintenance, Run: func(t *rapid.T, w *World) {
		n, err := w.App.Attachments.Sweep(context.Background(), w.Now)
		if err != nil {
			t.Fatalf("sweep: %v", err)
		}
		t.Logf("maintenance: swept %d files", n)
	}},
}

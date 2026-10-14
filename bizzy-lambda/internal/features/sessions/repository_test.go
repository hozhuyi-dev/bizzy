package sessions

import (
	"testing"
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/shared/docref"
)

// The indexes hold what their lists read: the to-do list (open), the
// events still to write (pending), and the sessions a package's credits
// cover.
func TestKeysFollowTheIndexes(t *testing.T) {
	start := time.Date(2026, 10, 12, 2, 0, 0, 0, time.UTC)
	s := Session{ID: "s1", ClientID: "jane", Start: start, End: start.Add(time.Hour), Location: LocationOwn,
		FeeCents: 9500, Invoice: &docref.Ref{DocumentID: "d1"}, Event: calendar.Link{EventID: "e1", Pending: true}}
	rec := toRecord(s)
	if rec.PK != "SESSION" || rec.SK != "s1" || rec.LSI2SK != "jane#"+rec.LSI1SK || rec.LSI3SK == "" || rec.LSI4SK == "" || rec.LSI5SK != "" {
		t.Errorf("keys = %+v", rec.Keys)
	}

	s.Record = &Record{Summary: "Seen"}
	s.Paid, s.Event.Pending, s.PackageID = nil, false, "p1"
	s.FeeCents, s.Invoice = 0, nil
	rec = toRecord(s)
	if rec.LSI3SK != "" || rec.LSI4SK != "" || rec.LSI5SK != "p1#"+rec.LSI1SK {
		t.Errorf("recorded on a credit, written: keys = %+v", rec.Keys)
	}
}

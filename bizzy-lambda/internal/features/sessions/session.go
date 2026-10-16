// Package sessions is the practice's sessions: the booking (who, when,
// where, whether confirmed), what pays for it (a package credit, or a fee
// on an invoice: see pricing.go), and what the user records about it
// afterwards (record.go). It knows nothing of the calendar: googlesync
// reads the user's events as these same actions, and writes sessions to
// events.
package sessions

import (
	"time"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/platform/txn"
)

// Location is where a session is: the user's own place, or a home visit.
type Location string

const (
	LocationOwn   Location = "own"
	LocationVisit Location = "visit"
)

type Session struct {
	ID        string    `json:"id"`
	ClientID  string    `json:"clientId"`
	Start     time.Time `json:"start"`
	End       time.Time `json:"end"`
	Tentative bool      `json:"tentative,omitempty"`
	// ConfirmedAt is when it stopped being tentative, or was booked
	// confirmed.
	ConfirmedAt *time.Time `json:"confirmedAt,omitempty"`
	Location    Location   `json:"location"`
	// PackageID is the package whose credit pays for it, chosen when it
	// was booked; "" when its fee does, on an invoice.
	PackageID string `json:"packageId,omitempty"`
	// Record is what the user wrote about it; its long notes are an item
	// of their own (Notes), and its files are attachments.
	Record    *Record   `json:"record,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// Record is a session's one-line summary, for lists and the client's
// timeline.
type Record struct {
	Summary   string    `json:"summary"`
	HasNotes  bool      `json:"hasNotes,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Sessions are filed by client and time, by the package whose credit pays
// for them, and as open while they will need the user once they happen:
// to confirm, or to record.
var Sessions = txn.Kind[Session]{
	Name: "SESSION", Gone: "This session was deleted.",
	Doc: txn.Doc{What: "A session: who, when, where, whether confirmed, the credit paying for it, and its summary.", Client: "its client, by start", Time: "its start", Open: "to confirm, or to record", Ref: "the package whose credit pays for it"},
	Meta: func(s *Session) txn.Meta {
		return txn.Meta{ID: s.ID, Client: s.ClientID, Time: s.Start, Open: s.Tentative || !s.Recorded(), Ref: s.PackageID}
	},
}

// MaxLength is how long a session may last.
const MaxLength = 12 * time.Hour

// Recorded reports whether its summary is written.
func (s Session) Recorded() bool { return s.Record != nil && s.Record.Summary != "" }

// Happened reports whether it has ended.
func (s Session) Happened(now time.Time) bool { return !s.End.After(now) }

// Source is what a document line for the session's fee covers.
func (s Session) Source() documents.Source { return documents.SessionSource(s.ID) }

// Reason is why a session is on the to-do list.
type Reason string

const (
	// ReasonConfirm: still tentative (a `?` title). Nothing else is asked
	// of it until it is confirmed.
	ReasonConfirm Reason = "confirm"
	// ReasonRecord: happened, with no summary yet.
	ReasonRecord Reason = "record"
	// ReasonCollect: happened, and its fee or the package bought in it is
	// still owed.
	ReasonCollect Reason = "collect"
)

// Todo is what is left to do on the session as of now, owing owedCents.
func (s Session) Todo(owedCents int64, now time.Time) []Reason {
	out := []Reason{}
	switch {
	case s.Tentative:
		out = append(out, ReasonConfirm)
	case s.Happened(now):
		if !s.Recorded() {
			out = append(out, ReasonRecord)
		}
		if owedCents > 0 {
			out = append(out, ReasonCollect)
		}
	}
	return out
}

// CreditsUsed is how many sessions use a package's credits
// (packages.Usage).
func CreditsUsed(tx *txn.Tx, packageID string) (int, error) {
	using, err := Sessions.WithRef(tx, packageID)
	return len(using), err
}

// overlaps reports whether two sessions take up the same time.
func (s Session) overlaps(o Session) bool {
	return s.ID != o.ID && o.Start.Before(s.End) && s.Start.Before(o.End)
}

// overlapping is a session, anyone's, at the same time as s.
func overlapping(tx *txn.Tx, s Session) (*Session, error) {
	around, err := Sessions.Between(tx, s.Start.Add(-MaxLength), s.End)
	if err != nil {
		return nil, err
	}
	for _, o := range around {
		if s.overlaps(*o) {
			return o, nil
		}
	}
	return nil, nil
}

// Describe names a session as a message does: "the session on 13 Oct".
func Describe(tx *txn.Tx, s *Session) string {
	return "the session on " + s.Start.In(tx.Location()).Format("2 Jan")
}

func day(tx *txn.Tx, t time.Time) string {
	return t.In(tx.Location()).Format(time.DateOnly)
}

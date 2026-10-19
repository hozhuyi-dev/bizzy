// Package sessions is the practice's sessions: the booking (who, when,
// where, whether confirmed), what pays for it (package credits, a fee on
// an invoice, or both: see pricing.go), and what the user records about it
// afterwards (record.go). It knows nothing of the calendar: googlesync
// reads the user's events as these same actions, and writes sessions to
// events.
package sessions

import (
	"time"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
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
	// Credits are the package credits paying for it, chosen when it was
	// booked, oldest package first; none when its fee alone does, on an
	// invoice.
	Credits []Credit `json:"credits,omitempty"`
	// Record is what the user wrote about it; its long notes are an item
	// of their own (Notes), and its files are attachments.
	Record    *Record   `json:"record,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// Credit is the time of a session a package's credits pay for.
type Credit struct {
	PackageID string `json:"packageId"`
	Minutes   int    `json:"minutes"`
}

// Record is a session's one-line summary, for lists and the client's
// timeline.
type Record struct {
	Summary   string    `json:"summary"`
	HasNotes  bool      `json:"hasNotes,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Sessions are filed by client and time, and as open while they will
// need the user once they happen: to confirm, or to record. The sessions
// using a package's credits are its client's (see CreditsUsed).
var Sessions = txn.Kind[Session]{
	Name: "SESSION", Gone: "This session was deleted.",
	Doc: txn.Doc{What: "A session: who, when, where, whether confirmed, the credits paying for it, and its summary.", Client: "its client, by start", Time: "its start", Open: "to confirm, or to record"},
	Meta: func(s *Session) txn.Meta {
		return txn.Meta{ID: s.ID, Client: s.ClientID, Time: s.Start, Open: s.Tentative || !s.Recorded()}
	},
}

// MaxLength is how long a session may last.
const MaxLength = 12 * time.Hour

// Step is what a session's length is charged by, in minutes: credits and
// the usual fee pay for it a half hour at a time.
const Step = 30

// Billable is how long a session is charged for, in minutes: its length
// rounded down to a Step, and at least one.
func (s Session) Billable() int {
	return max(int(s.End.Sub(s.Start)/time.Minute)/Step*Step, Step)
}

// CreditMinutes is how much of it credits pay for.
func (s Session) CreditMinutes() int {
	total := 0
	for _, c := range s.Credits {
		total += c.Minutes
	}
	return total
}

// Uses reports whether a package's credits pay for some of it.
func (s Session) Uses(packageID string) bool {
	for _, c := range s.Credits {
		if c.PackageID == packageID {
			return true
		}
	}
	return false
}

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

// CreditsUsed is how many minutes of a package's credits sessions use
// (packages.Usage). They are its client's sessions; for a package
// deleted, whose client is unknown, every session is counted.
func CreditsUsed(tx *txn.Tx, packageID string) (int, error) {
	p, ok, err := packages.Packages.Find(tx, packageID)
	if err != nil {
		return 0, err
	}
	var ss []*Session
	if ok {
		ss, err = Sessions.OfClient(tx, p.ClientID)
	} else {
		ss, err = Sessions.All(tx)
	}
	total := 0
	for _, s := range ss {
		for _, c := range s.Credits {
			if c.PackageID == packageID {
				total += c.Minutes
			}
		}
	}
	return total, err
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

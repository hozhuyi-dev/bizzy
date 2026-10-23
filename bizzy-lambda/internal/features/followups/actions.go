package followups

import (
	"strings"
	"time"
	"unicode/utf8"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// When is when a follow-up is due: a day (all-day), or a time and how
// long it blocks.
type When struct {
	// Date (YYYY-MM-DD) makes it all-day; otherwise Start is when.
	Date  string     `json:"date,omitempty"`
	Start *time.Time `json:"start,omitempty"`
	// Minutes is how long a timed one blocks; 0 keeps what it had, or
	// DefaultMinutes.
	Minutes int `json:"minutes,omitempty"`
}

// Fields are what the app or the calendar sets on a follow-up; nil leaves
// a field as it is.
type Fields struct {
	ClientID *string `json:"clientId,omitempty"`
	When     *When   `json:"when,omitempty"`
	Summary  *string `json:"summary,omitempty"`
	Notes    *string `json:"notes,omitempty"`
}

// Limits that fit a calendar event: the summary is in its title.
const (
	maxSummary = 200
	maxNotes   = 8000
)

// Create makes a follow-up, often from a session (sessionID, of its
// client).
func Create(tx *txn.Tx, f Fields, sessionID string) (*FollowUp, error) {
	if f.ClientID == nil || f.When == nil {
		return nil, apperr.Invalid("A follow-up needs a client and when.")
	}
	fu := &FollowUp{ID: tx.NewID(), CreatedAt: tx.Now().UTC()}
	if err := apply(tx, fu, f); err != nil {
		return nil, err
	}
	if sessionID != "" {
		s, err := sessions.Sessions.Get(tx, sessionID)
		if err != nil {
			return nil, err
		}
		if s.ClientID != fu.ClientID {
			return nil, apperr.Invalid("A follow-up from a session is for its client.")
		}
		fu.SessionID = s.ID
	}
	return fu, FollowUps.Add(tx, fu)
}

// Update changes what f sets.
func Update(tx *txn.Tx, id string, f Fields) (*FollowUp, error) {
	fu, err := FollowUps.Get(tx, id)
	if err != nil {
		return nil, err
	}
	return fu, apply(tx, fu, f)
}

// Delete deletes a follow-up.
func Delete(tx *txn.Tx, id string) error {
	if _, err := FollowUps.Get(tx, id); err != nil {
		return err
	}
	return FollowUps.Delete(tx, id)
}

// ReachedOutSummary is what a follow-up made by ReachedOut says.
const ReachedOutSummary = "Reached out"

// ReachedOut records that the user got back to the client today: a
// follow-up for today, done already. Done follow-ups are the record of
// contact (see activity); deleting it undoes a mis-tap.
func ReachedOut(tx *txn.Tx, clientID string) (*FollowUp, error) {
	summary := ReachedOutSummary
	today := tx.Now().In(tx.Location()).Format(time.DateOnly)
	fu, err := Create(tx, Fields{ClientID: &clientID, When: &When{Date: today}, Summary: &summary}, "")
	if err != nil {
		return nil, err
	}
	at := tx.Now().UTC()
	fu.DoneAt = &at
	return fu, nil
}

// SetDone marks a follow-up done, or not done again.
func SetDone(tx *txn.Tx, id string, done bool) (*FollowUp, error) {
	fu, err := FollowUps.Get(tx, id)
	if err != nil {
		return nil, err
	}
	switch {
	case done && fu.DoneAt == nil:
		at := tx.Now().UTC()
		fu.DoneAt = &at
	case !done:
		fu.DoneAt = nil
	}
	return fu, nil
}

func apply(tx *txn.Tx, fu *FollowUp, f Fields) error {
	if f.ClientID != nil {
		if _, err := clients.Clients.Get(tx, *f.ClientID); err != nil {
			return err
		}
		fu.ClientID = *f.ClientID
	}
	if f.When != nil {
		if err := setWhen(tx, fu, *f.When); err != nil {
			return err
		}
	}
	if f.Summary != nil {
		summary := strings.Join(strings.Fields(*f.Summary), " ")
		if utf8.RuneCountInString(summary) > maxSummary {
			return apperr.Invalid("Keep the summary to %d characters; the rest goes in the notes.", maxSummary)
		}
		fu.Summary = summary
	}
	if f.Notes != nil {
		notes := strings.TrimSpace(*f.Notes)
		if len(notes) > maxNotes {
			return apperr.Invalid("The notes are too long for a calendar event.")
		}
		fu.Notes = notes
	}
	return nil
}

func setWhen(tx *txn.Tx, fu *FollowUp, w When) error {
	if w.Date != "" {
		day, err := time.ParseInLocation(time.DateOnly, w.Date, tx.Location())
		if err != nil {
			return apperr.Invalid("The date must be YYYY-MM-DD.")
		}
		fu.Due, fu.AllDay, fu.Minutes = day.UTC(), true, 0
		return nil
	}
	if w.Start == nil || w.Start.IsZero() {
		return apperr.Invalid("Choose when to follow up.")
	}
	if w.Minutes < 0 || time.Duration(w.Minutes)*time.Minute > sessions.MaxLength {
		return apperr.Invalid("A follow-up blocks at most 12 hours.")
	}
	fu.Due, fu.AllDay = w.Start.UTC(), false
	switch {
	case w.Minutes > 0:
		fu.Minutes = w.Minutes
	case fu.Minutes == 0:
		fu.Minutes = DefaultMinutes
	}
	return nil
}

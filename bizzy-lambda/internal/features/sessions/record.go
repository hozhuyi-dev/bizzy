package sessions

import (
	"strings"
	"time"
	"unicode/utf8"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// What the user records on a session, once it has started: a one-line
// summary (Record), long notes (an item of their own, so lists never read
// them) and files (attachments).

// SessionNotes are a session's long notes.
type SessionNotes struct {
	SessionID string    `json:"sessionId"`
	Text      string    `json:"text"`
	UpdatedAt time.Time `json:"updatedAt"`
}

var Notes = txn.Kind[SessionNotes]{
	Name: "SESSIONNOTES", Gone: "This session has no notes.",
	Doc:  txn.Doc{What: "A session's long notes, apart so lists don't read them."},
	Meta: func(n *SessionNotes) txn.Meta { return txn.Meta{ID: n.SessionID} },
}

// Limits on what the user types, well inside DynamoDB's 400 KB per item.
const (
	maxSummary = 300
	maxNotes   = 50_000
)

// NotesOf is a session's notes; "" when it has none.
func NotesOf(tx *txn.Tx, sessionID string) (string, error) {
	n, ok, err := Notes.Find(tx, sessionID)
	if err != nil || !ok {
		return "", err
	}
	return n.Text, nil
}

// CanRecord is the refusal for writing on a session, or attaching files to
// it (attachments.Owner): only once it has started.
func CanRecord(tx *txn.Tx, id string) error {
	s, err := Sessions.Get(tx, id)
	if err != nil {
		return err
	}
	if s.Start.After(tx.Now()) {
		return apperr.Refused("Notes and files can be added once the session has started.")
	}
	return nil
}

// SaveRecord saves the summary and, unless notes is nil, the notes, as the
// user types (the app saves after a pause). Clearing both clears the
// record.
func SaveRecord(tx *txn.Tx, id, summary string, notes *string) (*Session, error) {
	summary = strings.TrimSpace(summary)
	if utf8.RuneCountInString(summary) > maxSummary {
		return nil, apperr.Invalid("Keep the summary to %d characters; the rest goes in the notes.", maxSummary)
	}
	if err := CanRecord(tx, id); err != nil {
		return nil, err
	}
	s, err := Sessions.Get(tx, id)
	if err != nil {
		return nil, err
	}
	hasNotes := s.Record != nil && s.Record.HasNotes
	if notes != nil {
		text := strings.TrimSpace(*notes)
		if len(text) > maxNotes {
			return nil, apperr.Invalid("The notes are too long to save.")
		}
		if err := setNotes(tx, id, text); err != nil {
			return nil, err
		}
		hasNotes = text != ""
	}
	s.Record = nil
	if summary != "" || hasNotes {
		s.Record = &Record{Summary: summary, HasNotes: hasNotes, UpdatedAt: tx.Now().UTC()}
	}
	return s, nil
}

func setNotes(tx *txn.Tx, id, text string) error {
	n, ok, err := Notes.Find(tx, id)
	switch {
	case err != nil:
		return err
	case text == "":
		return Notes.Delete(tx, id)
	case ok:
		n.Text, n.UpdatedAt = text, tx.Now().UTC()
		return nil
	}
	return Notes.Add(tx, &SessionNotes{SessionID: id, Text: text, UpdatedAt: tx.Now().UTC()})
}

// HasRecord reports whether the user wrote or attached anything on a
// session: what deleting its event in the calendar never takes with it.
func HasRecord(tx *txn.Tx, s *Session) (bool, error) {
	if s.Record != nil {
		return true, nil
	}
	n, err := attachments.Count(tx, attachments.OwnerSession, s.ID)
	return n > 0, err
}

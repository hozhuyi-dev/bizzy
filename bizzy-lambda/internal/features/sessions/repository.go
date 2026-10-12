package sessions

import (
	"context"
	"errors"
	"time"

	"bizzy-lambda/internal/features/docref"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/schema"
)

// Keys: see schema.SessionKeys and schema.SessionNotesKeys.

type record struct {
	dynamo.Keys
	Session
}

func toRecord(s Session) record {
	return record{Keys: schema.SessionKeys(s.EventID, s.Start, s.ClientID, string(s.Status), s.Open()), Session: s}
}

type notesRecord struct {
	dynamo.Keys
	Notes
}

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

func (r Repository) Get(ctx context.Context, eventID string) (Session, bool, error) {
	var rec record
	found, err := r.store.Get(ctx, schema.Session, eventID, &rec)
	return rec.Session, found, err
}

// ListByTime returns sessions starting in [from, to].
func (r Repository) ListByTime(ctx context.Context, from, to time.Time) ([]Session, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexTime, From: dynamo.TimeKey(from), To: dynamo.TimeKey(to)})
}

// ListByClient returns all of a client's sessions, oldest first, for the
// reconcile: package credits run across them all.
func (r Repository) ListByClient(ctx context.Context, clientID string) ([]Session, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexClient, Prefix: clientID + "#"})
}

// PageByClient returns a page of a client's sessions, newest first, for
// their timeline.
func (r Repository) PageByClient(ctx context.Context, clientID, cursor string, limit int) (dynamo.Page[Session], error) {
	q := dynamo.Query{PK: schema.Session, Index: dynamo.IndexClient, Prefix: clientID + "#", Descending: true}
	page, err := dynamo.QueryPage[record](ctx, r.store, q, limit, cursor)
	if err != nil {
		return dynamo.Page[Session]{}, err
	}
	return dynamo.Page[Session]{Items: unwrap(page.Items), Next: page.Next}, nil
}

// ListTodo returns the sessions in the to-do index starting up to until,
// oldest first. Everything she must act on has started by now, except
// tentative ones to confirm ahead, so reading a few days ahead is enough.
func (r Repository) ListTodo(ctx context.Context, until time.Time) ([]Session, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexOpen, To: dynamo.TimeKey(until)})
}

// ListByStatus returns the sessions with a status, newest first.
func (r Repository) ListByStatus(ctx context.Context, status Status) ([]Session, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexCategory, Prefix: string(status) + "#", Descending: true})
}

// ListWithoutClient returns the sessions matched to no client (unreadable,
// unmatched, or tentative under an unknown name), for when a client gains
// an alias.
func (r Repository) ListWithoutClient(ctx context.Context) ([]Session, error) {
	var out []Session
	for _, status := range []Status{StatusParseError, StatusUnmatched, StatusTentative} {
		found, err := r.ListByStatus(ctx, status)
		if err != nil {
			return nil, err
		}
		for _, s := range found {
			if s.ClientID == "" {
				out = append(out, s)
			}
		}
	}
	return out, nil
}

func (r Repository) query(ctx context.Context, q dynamo.Query) ([]Session, error) {
	q.PK = schema.Session
	records, err := dynamo.QueryAll[record](ctx, r.store, q)
	if err != nil {
		return nil, err
	}
	return unwrap(records), nil
}

func unwrap(records []record) []Session {
	all := make([]Session, len(records))
	for i, rec := range records {
		all[i] = rec.Session
	}
	return all
}

// Save writes the whole session if it is still at the version read (0 for
// a new one), and returns it at its new version. dynamo.ErrConflict means
// something else wrote it meanwhile: read it again and retry.
func (r Repository) Save(ctx context.Context, s Session) (Session, error) {
	previous := s.Version
	s.Version++
	if err := r.store.PutVersioned(ctx, toRecord(s), previous); err != nil {
		return Session{}, err
	}
	return s, nil
}

// Delete removes a session and its notes, if it is still at the version
// read and no document covers it. dynamo.ErrConflict otherwise.
func (r Repository) Delete(ctx context.Context, s Session) error {
	guard := dynamo.VersionIs(s.Version)
	docs := docref.NoDocuments()
	cond := &dynamo.Condition{
		Expression: guard.Expression + " AND " + docs.Expression,
		Names:      docs.Names,
		Values:     guard.Values,
	}
	for k, v := range guard.Names {
		cond.Names[k] = v
	}
	err := r.store.Transact(ctx, []dynamo.TransactItem{
		{Delete: &[2]string{schema.Session, s.EventID}, When: cond},
		{Delete: &[2]string{schema.SessionNotes, s.EventID}},
	})
	if errors.Is(err, dynamo.ErrTransactionConflict) {
		return dynamo.ErrConflict
	}
	return err
}

// Notes returns a session's long notes; empty when there are none.
func (r Repository) Notes(ctx context.Context, eventID string) (Notes, error) {
	var rec notesRecord
	_, err := r.store.Get(ctx, schema.SessionNotes, eventID, &rec)
	return rec.Notes, err
}

// SaveNotes writes a session's notes; empty text deletes them.
func (r Repository) SaveNotes(ctx context.Context, n Notes) error {
	if n.Text == "" {
		_, err := r.store.Delete(ctx, schema.SessionNotes, n.EventID, nil)
		return err
	}
	return r.store.Put(ctx, notesRecord{Keys: schema.SessionNotesKeys(n.EventID), Notes: n})
}

// LinkPatch reserves or updates a session's document link in a slot.
func LinkPatch(eventID string, slot docref.Slot, ref docref.Ref) (dynamo.Patch, error) {
	return docref.LinkPatch(schema.Session, eventID, slot, ref)
}

// UnlinkPatch releases a session's slot from a document.
func UnlinkPatch(eventID string, slot docref.Slot, documentID string) dynamo.Patch {
	return docref.UnlinkPatch(schema.Session, eventID, slot, documentID)
}

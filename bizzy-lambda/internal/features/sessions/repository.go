package sessions

import (
	"context"
	"time"

	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/schema"
)

// Keys: see schema.SessionKeys and schema.SessionNotesKeys.

type record struct {
	dynamo.Keys
	Session
}

func toRecord(s Session) record {
	return record{Keys: schema.SessionKeys(s.ID, s.Start, s.ClientID, s.Open(), s.Event.Pending, s.PackageID), Session: s}
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

func (r Repository) Get(ctx context.Context, id string) (Session, bool, error) {
	var rec record
	found, err := r.store.Get(ctx, schema.Session, id, &rec)
	return rec.Session, found, err
}

// ListByTime returns sessions starting in [from, to].
func (r Repository) ListByTime(ctx context.Context, from, to time.Time) ([]Session, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexTime, From: dynamo.TimeKey(from), To: dynamo.TimeKey(to)})
}

// ListByClient returns all of a client's sessions, oldest first.
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

// ListPending returns the sessions whose event is still to be written.
func (r Repository) ListPending(ctx context.Context) ([]Session, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexCategory})
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

// PutItem is Save as one write in a transaction with other items: it
// returns the session at its new version, and the write that stores it if
// it is still at the version read.
func PutItem(s Session) (Session, dynamo.TransactItem) {
	previous := s.Version
	s.Version++
	return s, dynamo.TransactItem{Put: toRecord(s), When: dynamo.VersionIs(previous)}
}

// DeleteItems are the writes that delete a session at the version read,
// and its notes.
func DeleteItems(s Session) []dynamo.TransactItem {
	return []dynamo.TransactItem{
		{Delete: &[2]string{schema.Session, s.ID}, When: dynamo.VersionIs(s.Version)},
		{Delete: &[2]string{schema.SessionNotes, s.ID}},
	}
}

// Notes returns a session's long notes; empty when there are none.
func (r Repository) Notes(ctx context.Context, id string) (Notes, error) {
	var rec notesRecord
	_, err := r.store.Get(ctx, schema.SessionNotes, id, &rec)
	return rec.Notes, err
}

// SaveNotes writes a session's notes; empty text deletes them.
func (r Repository) SaveNotes(ctx context.Context, n Notes) error {
	if n.Text == "" {
		_, err := r.store.Delete(ctx, schema.SessionNotes, n.SessionID, nil)
		return err
	}
	return r.store.Put(ctx, notesRecord{Keys: schema.SessionNotesKeys(n.SessionID), Notes: n})
}

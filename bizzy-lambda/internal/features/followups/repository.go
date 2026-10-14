package followups

import (
	"context"
	"time"

	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/schema"
)

// Keys: see schema.FollowUpKeys.

type record struct {
	dynamo.Keys
	FollowUp
}

func toRecord(f FollowUp) record {
	return record{Keys: schema.FollowUpKeys(f.ID, f.Due, f.ClientID, f.DoneAt != nil, f.SessionID), FollowUp: f}
}

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

func (r Repository) Get(ctx context.Context, id string) (FollowUp, bool, error) {
	var rec record
	found, err := r.store.Get(ctx, schema.FollowUp, id, &rec)
	return rec.FollowUp, found, err
}

// ListByTime returns follow-ups due in [from, to], for the sync.
func (r Repository) ListByTime(ctx context.Context, from, to time.Time) ([]FollowUp, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexTime, From: dynamo.TimeKey(from), To: dynamo.TimeKey(to)})
}

// ListOpen returns the follow-ups not done yet that are due up to until,
// oldest first: her to-do list.
func (r Repository) ListOpen(ctx context.Context, until time.Time) ([]FollowUp, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexOpen, To: dynamo.TimeKey(until)})
}

// ListByClient returns all of a client's follow-ups.
func (r Repository) ListByClient(ctx context.Context, clientID string) ([]FollowUp, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexClient, Prefix: clientID + "#"})
}

// ListBySession returns the follow-ups made from a session.
func (r Repository) ListBySession(ctx context.Context, sessionID string) ([]FollowUp, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexRelation, Prefix: sessionID + "#"})
}

// PageOpen returns a page of the follow-ups not done yet, soonest first.
func (r Repository) PageOpen(ctx context.Context, cursor string, limit int) (dynamo.Page[FollowUp], error) {
	return r.page(ctx, dynamo.Query{Index: dynamo.IndexOpen}, cursor, limit)
}

// PageDone returns a page of the follow-ups done, latest due first.
func (r Repository) PageDone(ctx context.Context, cursor string, limit int) (dynamo.Page[FollowUp], error) {
	return r.page(ctx, dynamo.Query{Index: dynamo.IndexCategory, Prefix: "done#", Descending: true}, cursor, limit)
}

// PageByClient returns a page of a client's follow-ups, latest due first.
func (r Repository) PageByClient(ctx context.Context, clientID, cursor string, limit int) (dynamo.Page[FollowUp], error) {
	return r.page(ctx, dynamo.Query{Index: dynamo.IndexClient, Prefix: clientID + "#", Descending: true}, cursor, limit)
}

func (r Repository) page(ctx context.Context, q dynamo.Query, cursor string, limit int) (dynamo.Page[FollowUp], error) {
	q.PK = schema.FollowUp
	page, err := dynamo.QueryPage[record](ctx, r.store, q, limit, cursor)
	if err != nil {
		return dynamo.Page[FollowUp]{}, err
	}
	return dynamo.Page[FollowUp]{Items: unwrap(page.Items), Next: page.Next}, nil
}

func (r Repository) query(ctx context.Context, q dynamo.Query) ([]FollowUp, error) {
	q.PK = schema.FollowUp
	records, err := dynamo.QueryAll[record](ctx, r.store, q)
	if err != nil {
		return nil, err
	}
	return unwrap(records), nil
}

func unwrap(records []record) []FollowUp {
	all := make([]FollowUp, len(records))
	for i, rec := range records {
		all[i] = rec.FollowUp
	}
	return all
}

// ListPending returns the follow-ups whose event is still to be written.
// They are few, so the whole partition is read rather than kept in an
// index of their own.
func (r Repository) ListPending(ctx context.Context) ([]FollowUp, error) {
	all, err := r.query(ctx, dynamo.Query{Index: dynamo.IndexTime})
	if err != nil {
		return nil, err
	}
	var out []FollowUp
	for _, f := range all {
		if f.Event.Pending {
			out = append(out, f)
		}
	}
	return out, nil
}

// Save writes the whole follow-up if it is still at the version read (0
// for a new one) and returns it at its new version; dynamo.ErrConflict
// otherwise. Only what a follow-up's event says it shows is saved this way
// (see googlesync); everything else changes through the book.
func (r Repository) Save(ctx context.Context, f FollowUp) (FollowUp, error) {
	previous := f.Version
	f.Version++
	if err := r.store.PutVersioned(ctx, toRecord(f), previous); err != nil {
		return FollowUp{}, err
	}
	return f, nil
}

// PutItem is Save as one write in a transaction with other items.
func PutItem(f FollowUp) dynamo.TransactItem {
	previous := f.Version
	f.Version++
	return dynamo.TransactItem{Put: toRecord(f), When: dynamo.VersionIs(previous)}
}

// DeleteItem deletes a follow-up at the version read.
func DeleteItem(f FollowUp) dynamo.TransactItem {
	return dynamo.TransactItem{Delete: &[2]string{schema.FollowUp, f.ID}, When: dynamo.VersionIs(f.Version)}
}

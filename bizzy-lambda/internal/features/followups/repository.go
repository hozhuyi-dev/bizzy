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
	return record{Keys: schema.FollowUpKeys(f.EventID, f.Due, f.ClientID, f.DoneAt != nil, f.SessionID), FollowUp: f}
}

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

func (r Repository) Get(ctx context.Context, eventID string) (FollowUp, bool, error) {
	var rec record
	found, err := r.store.Get(ctx, schema.FollowUp, eventID, &rec)
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

// Save writes the whole follow-up if it is still at the version read (0
// for a new one) and returns it at its new version; dynamo.ErrConflict
// otherwise.
func (r Repository) Save(ctx context.Context, f FollowUp) (FollowUp, error) {
	previous := f.Version
	f.Version++
	if err := r.store.PutVersioned(ctx, toRecord(f), previous); err != nil {
		return FollowUp{}, err
	}
	return f, nil
}

// Delete removes a follow-up whatever its version: its event is gone.
func (r Repository) Delete(ctx context.Context, eventID string) error {
	_, err := r.store.Delete(ctx, schema.FollowUp, eventID, nil)
	return err
}

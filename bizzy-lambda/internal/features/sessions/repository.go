package sessions

import (
	"context"
	"time"

	"bizzy-lambda/internal/features/docref"
	"bizzy-lambda/internal/platform/dynamo"
)

// Partition holds every session, SK = event ID.
//
//	LSI1 (time)     start
//	LSI2 (client)   clientId#start, when matched
//	LSI3 (open)     start, while it needs her action
//	LSI4 (category) status#start
const Partition = "SESSION"

// ownedAttributes are written by Save (sync + reconcile). `document` is hers
// and is never touched by it.
var ownedAttributes = append([]string{
	"eventId", "title", "start", "end", "colorId", "removed",
	"status", "name", "clientId", "suggestedClientId", "feeCents", "feeSource",
	"packageId", "valueCents", "location", "locationSource", "reason", "drift",
}, dynamo.IndexAttributes...)

type record struct {
	dynamo.Keys
	Session
}

func toRecord(s Session) record {
	start := dynamo.TimeKey(s.Start)
	keys := dynamo.Keys{
		PK:     Partition,
		SK:     s.EventID,
		LSI1SK: start,
		LSI4SK: string(s.Status) + "#" + start,
	}
	if s.ClientID != "" {
		keys.LSI2SK = s.ClientID + "#" + start
	}
	if s.Open() {
		keys.LSI3SK = start
	}
	return record{Keys: keys, Session: s}
}

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

func (r Repository) Get(ctx context.Context, eventID string) (Session, bool, error) {
	var rec record
	found, err := r.store.Get(ctx, Partition, eventID, &rec)
	return rec.Session, found, err
}

// ListByTime returns sessions starting in [from, to].
func (r Repository) ListByTime(ctx context.Context, from, to time.Time) ([]Session, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexTime, From: dynamo.TimeKey(from), To: dynamo.TimeKey(to)})
}

func (r Repository) ListByClient(ctx context.Context, clientID string) ([]Session, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexClient, Prefix: clientID + "#"})
}

// ListOpen returns her to-do list, oldest first.
func (r Repository) ListOpen(ctx context.Context) ([]Session, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexOpen})
}

func (r Repository) query(ctx context.Context, q dynamo.Query) ([]Session, error) {
	q.PK = Partition
	records, err := dynamo.QueryAll[record](ctx, r.store, q)
	if err != nil {
		return nil, err
	}
	all := make([]Session, len(records))
	for i, rec := range records {
		all[i] = rec.Session
	}
	return all, nil
}

// Save writes the calendar and derived fields, leaving hers alone.
func (r Repository) Save(ctx context.Context, s Session) error {
	p, err := dynamo.OwnedFrom(Partition, s.EventID, toRecord(s), ownedAttributes)
	if err != nil {
		return err
	}
	_, err = r.store.Apply(ctx, p)
	return err
}

// Delete removes a session unless a receipt has claimed it in the meantime.
func (r Repository) Delete(ctx context.Context, eventID string) (bool, error) {
	return r.store.Delete(ctx, Partition, eventID, &dynamo.Condition{
		Expression: "attribute_not_exists(#doc)",
		Names:      map[string]string{"#doc": docref.Attribute},
	})
}

// LinkPatch reserves or updates the session's document link.
func LinkPatch(eventID string, ref docref.Ref) (dynamo.Patch, error) {
	return docref.LinkPatch(Partition, eventID, ref)
}

// UnlinkPatch releases the session from a document.
func UnlinkPatch(eventID, documentID string) dynamo.Patch {
	return docref.UnlinkPatch(Partition, eventID, documentID)
}

package documents

import (
	"context"
	"strconv"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/schema"
)

// Keys: see schema.DocumentKeys and the DOCREV, COUNTER and DOCSHARE rows
// there.
const (
	docPartition      = schema.Document
	revisionPartition = schema.DocumentRevision
	counterPartition  = schema.Counter
	sharePartition    = schema.DocumentShare
)

type shareRecord struct {
	dynamo.Keys
	DocumentID string `dynamodbav:"documentId"`
}

type docRecord struct {
	dynamo.Keys
	Document
}

func toDocRecord(d Document) docRecord {
	return docRecord{Keys: schema.DocumentKeys(d.ID, d.Date, d.CreatedAt, d.ClientID, string(d.Type)), Document: d}
}

type revisionRecord struct {
	dynamo.Keys
	Revision
}

type counterRecord struct {
	dynamo.Keys
	Last int64 `dynamodbav:"last"`
}

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

func (r Repository) Get(ctx context.Context, id string) (Document, bool, error) {
	var rec docRecord
	found, err := r.store.Get(ctx, docPartition, id, &rec)
	return rec.Document, found, err
}

// ListByMonth returns one type of document dated in a month ("2026-10"),
// newest first. The category index sorts by type#date, so the month is a
// key prefix; drafts have no date yet, so they never match.
func (r Repository) ListByMonth(ctx context.Context, docType Type, month string) ([]Document, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexCategory, Prefix: string(docType) + "#" + month + "-", Descending: true})
}

// ListByClient returns every document for a client, of any type, newest
// first, drafts last.
func (r Repository) ListByClient(ctx context.Context, clientID string) ([]Document, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexClient, Prefix: clientID + "#", Descending: true})
}

func (r Repository) query(ctx context.Context, q dynamo.Query) ([]Document, error) {
	q.PK = docPartition
	records, err := dynamo.QueryAll[docRecord](ctx, r.store, q)
	if err != nil {
		return nil, err
	}
	all := make([]Document, len(records))
	for i, rec := range records {
		all[i] = rec.Document
	}
	return all, nil
}

// SharedID returns the document a share token opens.
func (r Repository) SharedID(ctx context.Context, token string) (string, bool, error) {
	var rec shareRecord
	found, err := r.store.Get(ctx, sharePartition, token, &rec)
	return rec.DocumentID, found, err
}

// Revisions returns a document's issued revisions, oldest first.
func (r Repository) Revisions(ctx context.Context, id string) ([]Revision, error) {
	records, err := dynamo.QueryAll[revisionRecord](ctx, r.store, dynamo.Query{PK: revisionPartition, Prefix: id + "#"})
	if err != nil {
		return nil, err
	}
	all := make([]Revision, len(records))
	for i, rec := range records {
		all[i] = rec.Revision
	}
	return all, nil
}

// Counter returns the last number issued from a sequence (0 if none yet).
func (r Repository) Counter(ctx context.Context, key string) (int64, error) {
	var rec counterRecord
	_, err := r.store.Get(ctx, counterPartition, key, &rec)
	return rec.Last, err
}

// SetShare stores a document with a new share token, retiring the old one,
// if it is still at the version read. dynamo.ErrTransactionConflict means
// it changed meanwhile.
func (r Repository) SetShare(ctx context.Context, d Document, change ShareChange) error {
	_, item := PutItem(d)
	return r.store.Transact(ctx, append([]dynamo.TransactItem{item}, ShareItems(d.ID, change)...))
}

// PutItem is the write that stores a document if it is still at the
// version read (0 for a new one), and the document at its new version.
func PutItem(d Document) (Document, dynamo.TransactItem) {
	previous := d.Version
	d.Version++
	return d, dynamo.TransactItem{Put: toDocRecord(d), When: dynamo.VersionIs(previous)}
}

// DeleteItem is the write that deletes a document at the version read.
func DeleteItem(d Document) dynamo.TransactItem {
	return dynamo.TransactItem{Delete: &[2]string{docPartition, d.ID}, When: dynamo.VersionIs(d.Version)}
}

// RevisionItem stores an issued revision, once.
func RevisionItem(rev Revision) dynamo.TransactItem {
	return dynamo.TransactItem{
		Put:  revisionRecord{Keys: schema.DocumentRevisionKeys(rev.DocumentID, rev.Revision), Revision: rev},
		When: &dynamo.Condition{Expression: "attribute_not_exists(PK)"},
	}
}

// CounterBump takes the next number of a sequence.
type CounterBump struct {
	Key        string
	Prev, Next int64
}

// CounterItem moves a sequence on, if no one took the number first.
func CounterItem(c CounterBump) dynamo.TransactItem {
	cond := "#last = :prev"
	if c.Prev == 0 {
		cond = "attribute_not_exists(#last) OR #last = :prev"
	}
	return dynamo.TransactItem{Patch: &dynamo.Patch{
		PK: counterPartition, SK: c.Key,
		Set: map[string]types.AttributeValue{"last": &types.AttributeValueMemberN{Value: strconv.FormatInt(c.Next, 10)}},
		When: &dynamo.Condition{
			Expression: cond,
			Names:      map[string]string{"#last": "last"},
			Values:     map[string]types.AttributeValue{":prev": &types.AttributeValueMemberN{Value: strconv.FormatInt(c.Prev, 10)}},
		},
	}}
}

// ShareChange points a new share token at a document, retiring the old.
type ShareChange struct {
	New string
	// Old is the token it replaces, if any; its link stops working.
	Old string
}

// ShareItems are the writes of a share change.
func ShareItems(documentID string, s ShareChange) []dynamo.TransactItem {
	items := []dynamo.TransactItem{{
		Put:  shareRecord{Keys: schema.DocumentShareKeys(s.New), DocumentID: documentID},
		When: &dynamo.Condition{Expression: "attribute_not_exists(PK)"},
	}}
	if s.Old != "" {
		items = append(items, dynamo.TransactItem{Delete: &[2]string{sharePartition, s.Old}})
	}
	return items
}

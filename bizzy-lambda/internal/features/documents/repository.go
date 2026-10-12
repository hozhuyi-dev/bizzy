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
	draftOpen := d.Draft != nil && d.Status != StatusCancelled
	return docRecord{Keys: schema.DocumentKeys(d.ID, d.Date, d.CreatedAt, d.ClientID, string(d.Type), draftOpen), Document: d}
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
// key prefix.
func (r Repository) ListByMonth(ctx context.Context, docType Type, month string) ([]Document, error) {
	records, err := dynamo.QueryAll[docRecord](ctx, r.store, dynamo.Query{
		PK: docPartition, Index: dynamo.IndexCategory, Prefix: string(docType) + "#" + month + "-", Descending: true,
	})
	if err != nil {
		return nil, err
	}
	all := make([]Document, len(records))
	for i, rec := range records {
		all[i] = rec.Document
	}
	return all, nil
}

// ListByClient returns every document for a client, of any type, newest
// first.
func (r Repository) ListByClient(ctx context.Context, clientID string) ([]Document, error) {
	records, err := dynamo.QueryAll[docRecord](ctx, r.store, dynamo.Query{
		PK: docPartition, Index: dynamo.IndexClient, Prefix: clientID + "#", Descending: true,
	})
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

// Write is one change to a document, committed atomically with the links
// and counters it implies.
type Write struct {
	Doc Document
	// PreviousVersion is the version read before the change; 0 for a new
	// document. The write fails if someone else changed it since.
	PreviousVersion int
	// Delete removes the document instead of writing it (a discarded draft).
	Delete bool
	// Counter takes the next number, when the document is first issued.
	Counter *CounterBump
	// Revision is stored when the document is issued.
	Revision *Revision
	// Links are the patches to the sessions and packages it covers.
	Links []dynamo.Patch
	// Share points a new share token at the document, retiring the old one.
	Share *ShareChange
}

type ShareChange struct {
	New string
	// Old is the token it replaces, if any; its link stops working.
	Old string
}

type CounterBump struct {
	Key        string
	Prev, Next int64
}

// Commit applies a Write in one transaction. dynamo.ErrTransactionConflict
// means something changed since it was read.
func (r Repository) Commit(ctx context.Context, w Write) error {
	var items []dynamo.TransactItem

	guard := &dynamo.Condition{Expression: "attribute_not_exists(PK)"}
	if w.PreviousVersion > 0 {
		guard = &dynamo.Condition{
			Expression: "#version = :version",
			Names:      map[string]string{"#version": "version"},
			Values:     map[string]types.AttributeValue{":version": &types.AttributeValueMemberN{Value: strconv.Itoa(w.PreviousVersion)}},
		}
	}

	if w.Delete {
		items = append(items, dynamo.TransactItem{Delete: &[2]string{docPartition, w.Doc.ID}, When: guard})
	} else {
		items = append(items, dynamo.TransactItem{Put: toDocRecord(w.Doc), When: guard})
	}

	if c := w.Counter; c != nil {
		cond := "#last = :prev"
		if c.Prev == 0 {
			cond = "attribute_not_exists(#last) OR #last = :prev"
		}
		items = append(items, dynamo.TransactItem{Patch: &dynamo.Patch{
			PK: counterPartition, SK: c.Key,
			Set: map[string]types.AttributeValue{"last": &types.AttributeValueMemberN{Value: strconv.FormatInt(c.Next, 10)}},
			When: &dynamo.Condition{
				Expression: cond,
				Names:      map[string]string{"#last": "last"},
				Values:     map[string]types.AttributeValue{":prev": &types.AttributeValueMemberN{Value: strconv.FormatInt(c.Prev, 10)}},
			},
		}})
	}

	if rev := w.Revision; rev != nil {
		items = append(items, dynamo.TransactItem{
			Put:  revisionRecord{Keys: schema.DocumentRevisionKeys(rev.DocumentID, rev.Revision), Revision: *rev},
			When: &dynamo.Condition{Expression: "attribute_not_exists(PK)"},
		})
	}

	if s := w.Share; s != nil {
		items = append(items, dynamo.TransactItem{
			Put:  shareRecord{Keys: schema.DocumentShareKeys(s.New), DocumentID: w.Doc.ID},
			When: &dynamo.Condition{Expression: "attribute_not_exists(PK)"},
		})
		if s.Old != "" {
			items = append(items, dynamo.TransactItem{Delete: &[2]string{sharePartition, s.Old}})
		}
	}

	for i := range w.Links {
		items = append(items, dynamo.TransactItem{Patch: &w.Links[i]})
	}

	return r.store.Transact(ctx, items)
}

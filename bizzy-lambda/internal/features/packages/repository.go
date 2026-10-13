package packages

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"bizzy-lambda/internal/features/docref"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/schema"
)

// Keys: see schema.PackageKeys.
const Partition = schema.Package

// ownedAttributes are written by Save; the payment is the payments
// feature's (PaymentPatch), and the document slots (and the version their
// links bump) the documents feature's.
var ownedAttributes = append([]string{
	"id", "clientId", "sessions", "priceCents", "purchasedAt", "source", "note",
	"creditsUsed",
}, dynamo.IndexAttributes...)

type record struct {
	dynamo.Keys
	Package
}

func toRecord(p Package) record {
	return record{Keys: schema.PackageKeys(p.ID, p.PurchasedAt, p.ClientID, string(p.Source), p.Open()), Package: p}
}

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

func (r Repository) Get(ctx context.Context, id string) (Package, bool, error) {
	var rec record
	found, err := r.store.Get(ctx, Partition, id, &rec)
	return rec.Package, found, err
}

// List returns every package, newest first.
func (r Repository) List(ctx context.Context) ([]Package, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexTime, Descending: true})
}

// ListOpen returns packages with credits left or still to be paid, oldest
// first.
func (r Repository) ListOpen(ctx context.Context) ([]Package, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexOpen})
}

func (r Repository) ListByClient(ctx context.Context, clientID string) ([]Package, error) {
	return r.query(ctx, dynamo.Query{Index: dynamo.IndexClient, Prefix: clientID + "#"})
}

func (r Repository) query(ctx context.Context, q dynamo.Query) ([]Package, error) {
	q.PK = Partition
	records, err := dynamo.QueryAll[record](ctx, r.store, q)
	if err != nil {
		return nil, err
	}
	all := make([]Package, len(records))
	for i, rec := range records {
		all[i] = rec.Package
	}
	return all, nil
}

// Save writes everything but the payment and the document links.
func (r Repository) Save(ctx context.Context, p Package) error {
	patch, err := dynamo.OwnedFrom(Partition, p.ID, toRecord(p), ownedAttributes)
	if err != nil {
		return err
	}
	_, err = r.store.Apply(ctx, patch)
	return err
}

// SetPayment writes p.Payment; see PaymentPatch.
func (r Repository) SetPayment(ctx context.Context, p Package) error {
	patch, err := PaymentPatch(p)
	if err != nil {
		return err
	}
	applied, err := r.store.Apply(ctx, patch)
	if err == nil && !applied {
		return apperr.Conflict("a receipt covers this package; cancel or discard it first")
	}
	return err
}

// Delete removes a package unless a document has claimed it.
func (r Repository) Delete(ctx context.Context, id string) (bool, error) {
	return r.store.Delete(ctx, Partition, id, docref.NoDocuments())
}

// PaymentPatch writes p.Payment (nil clears it) and moves the package in or
// out of the open index to match. It only applies while no receipt covers
// the package, and leaves everything else to Save.
func PaymentPatch(p Package) (dynamo.Patch, error) {
	patch := dynamo.Patch{
		PK: Partition, SK: p.ID,
		Set: map[string]types.AttributeValue{},
		When: &dynamo.Condition{
			Expression: "attribute_exists(PK) AND attribute_not_exists(#receipt)",
			Names:      map[string]string{"#receipt": string(docref.SlotReceipt)},
		},
	}
	if p.Payment == nil {
		patch.Remove = append(patch.Remove, "payment")
	} else {
		av, err := attributevalue.Marshal(p.Payment)
		if err != nil {
			return dynamo.Patch{}, err
		}
		patch.Set["payment"] = av
	}
	if open := toRecord(p).LSI3SK; open != "" {
		patch.Set["LSI3SK"] = dynamo.S(open)
	} else {
		patch.Remove = append(patch.Remove, "LSI3SK")
	}
	return patch, nil
}

func LinkPatch(id string, slot docref.Slot, ref docref.Ref) (dynamo.Patch, error) {
	return docref.LinkPatch(Partition, id, slot, ref)
}

func UnlinkPatch(id string, slot docref.Slot, documentID string) dynamo.Patch {
	return docref.UnlinkPatch(Partition, id, slot, documentID)
}

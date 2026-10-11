// Package docref is the link a session or package keeps to the document (a
// receipt) that covers it. It lives apart from documents so sessions and
// packages can carry it without importing the documents feature.
package docref

import (
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"bizzy-lambda/internal/platform/dynamo"
)

// Ref is written by the documents feature only.
type Ref struct {
	DocumentID string `json:"documentId" dynamodbav:"documentId"`
	// The rest is set once the document is issued; a draft only reserves.
	Number      string `json:"number,omitempty" dynamodbav:"number,omitempty"`
	AmountCents *int64 `json:"amountCents,omitempty" dynamodbav:"amountCents,omitempty"`
	// Date (YYYY-MM-DD) and ClientID are what the document says, so the
	// sync can flag a calendar change that contradicts it.
	Date     string `json:"date,omitempty" dynamodbav:"date,omitempty"`
	ClientID string `json:"clientId,omitempty" dynamodbav:"clientId,omitempty"`
}

// Issued reports whether the document has been issued, as opposed to a
// draft holding the source.
func (r *Ref) Issued() bool {
	return r != nil && r.Number != ""
}

// Attribute is the item attribute holding the Ref on sessions and packages.
const Attribute = "document"

// LinkPatch points an item at a document. It only applies while the item is
// unclaimed or already claimed by the same document, so two receipts can
// never cover one session.
func LinkPatch(pk, sk string, ref Ref) (dynamo.Patch, error) {
	av, err := attributevalue.Marshal(ref)
	if err != nil {
		return dynamo.Patch{}, err
	}
	return dynamo.Patch{
		PK: pk, SK: sk,
		Set: map[string]types.AttributeValue{Attribute: av},
		When: &dynamo.Condition{
			Expression: "attribute_exists(PK) AND (attribute_not_exists(#doc) OR #doc.documentId = :docId)",
			Names:      map[string]string{"#doc": Attribute},
			Values:     map[string]types.AttributeValue{":docId": dynamo.S(ref.DocumentID)},
		},
	}, nil
}

// UnlinkPatch releases an item from a document.
func UnlinkPatch(pk, sk, documentID string) dynamo.Patch {
	return dynamo.Patch{
		PK: pk, SK: sk,
		Remove: []string{Attribute},
		When: &dynamo.Condition{
			Expression: "#doc.documentId = :docId",
			Names:      map[string]string{"#doc": Attribute},
			Values:     map[string]types.AttributeValue{":docId": dynamo.S(documentID)},
		},
	}
}

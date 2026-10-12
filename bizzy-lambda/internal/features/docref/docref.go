// Package docref is the link a session or package keeps to each document (an
// invoice, a receipt) that covers it. It lives apart from documents so
// sessions and packages can carry it without importing the documents
// feature.
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
	Number   string `json:"number,omitempty" dynamodbav:"number,omitempty"`
	Revision int    `json:"revision,omitempty" dynamodbav:"revision,omitempty"`
	// AmountCents is what the document says the item comes to.
	AmountCents *int64 `json:"amountCents,omitempty" dynamodbav:"amountCents,omitempty"`
	// Date (YYYY-MM-DD) and ClientID are what the document says, so the
	// sync can flag a calendar change that contradicts it.
	Date     string `json:"date,omitempty" dynamodbav:"date,omitempty"`
	ClientID string `json:"clientId,omitempty" dynamodbav:"clientId,omitempty"`
}

// Issued reports whether the document has been issued, as opposed to a
// draft holding the item.
func (r *Ref) Issued() bool {
	return r != nil && r.Number != ""
}

// Slot is the item attribute holding the Ref for one document type. Each
// type has its own, so a session can have both an invoice and a receipt.
type Slot string

const (
	SlotInvoice Slot = "invoice"
	SlotReceipt Slot = "receipt"
)

// Slots lists every slot, for code that checks an item has no documents.
var Slots = []Slot{SlotInvoice, SlotReceipt}

// LinkPatch points an item's slot at a document. It only applies while the
// slot is free or already the same document's, so two receipts can never
// cover one session. It bumps the item's version: sessions are written
// whole with a version check, and must not overwrite the link.
func LinkPatch(pk, sk string, slot Slot, ref Ref) (dynamo.Patch, error) {
	av, err := attributevalue.Marshal(ref)
	if err != nil {
		return dynamo.Patch{}, err
	}
	return dynamo.Patch{
		PK: pk, SK: sk,
		Set:       map[string]types.AttributeValue{string(slot): av},
		Increment: []string{dynamo.VersionAttribute},
		When: &dynamo.Condition{
			Expression: "attribute_exists(PK) AND (attribute_not_exists(#doc) OR #doc.documentId = :docId)",
			Names:      map[string]string{"#doc": string(slot)},
			Values:     map[string]types.AttributeValue{":docId": dynamo.S(ref.DocumentID)},
		},
	}, nil
}

// UnlinkPatch releases an item's slot from a document.
func UnlinkPatch(pk, sk string, slot Slot, documentID string) dynamo.Patch {
	return dynamo.Patch{
		PK: pk, SK: sk,
		Remove:    []string{string(slot)},
		Increment: []string{dynamo.VersionAttribute},
		When: &dynamo.Condition{
			Expression: "#doc.documentId = :docId",
			Names:      map[string]string{"#doc": string(slot)},
			Values:     map[string]types.AttributeValue{":docId": dynamo.S(documentID)},
		},
	}
}

// NoDocuments is a condition that holds while an item has no document in
// any slot.
func NoDocuments() *dynamo.Condition {
	c := &dynamo.Condition{Names: map[string]string{}}
	for i, slot := range Slots {
		name := "#slot" + string(rune('0'+i))
		if i > 0 {
			c.Expression += " AND "
		}
		c.Expression += "attribute_not_exists(" + name + ")"
		c.Names[name] = string(slot)
	}
	return c
}

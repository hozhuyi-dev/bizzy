// Package docref is the link a session or package keeps to each document (an
// invoice, a receipt) whose line covers it. It lives apart from documents so
// sessions and packages can carry it without importing the documents
// feature.
//
// The link carries nothing the document says beyond its number: the money
// is copied separately (see book.Derive), from the document's lines, so the
// two never disagree.
package docref

// Ref is written by the book only (see internal/features/book).
type Ref struct {
	DocumentID string `json:"documentId" dynamodbav:"documentId"`
	// Number and Revision are set once the document is issued.
	Number   string `json:"number,omitempty" dynamodbav:"number,omitempty"`
	Revision int    `json:"revision,omitempty" dynamodbav:"revision,omitempty"`
}

// Issued reports whether the document has been issued, as opposed to a
// draft.
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

// Slots lists every slot.
var Slots = []Slot{SlotInvoice, SlotReceipt}

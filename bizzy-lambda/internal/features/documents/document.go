// Package documents is the business's invoices and receipts, which is
// where bizzy keeps money: what a session or package costs is its invoice
// line, and what was received for it its receipt line. Nothing else holds
// an amount of its own.
//
// Every document has the same lifecycle:
//
//	draft ──issue──▶ issued rev 0 ──revise──▶ (draft on top) ──issue──▶ rev 1 …
//	                       │
//	                    cancel (the number stays used; its lines go back to a draft)
//
// A draft is made with what it covers: a session's invoice when it is
// booked, a receipt when a payment is recorded. Until it is issued
// anything on it can change. Issuing takes the next number and freezes it:
// a revision may only correct what has no legal weight (see Legal), and
// anything else goes through cancelling it. Every issued revision is kept.
//
// The features whose items documents cover (sessions, packages, payments)
// change lines only through ledger.go, which refuses to change what an
// issued document says, and keeps the Links that say which invoice and
// which receipt cover each item.
package documents

import (
	"time"

	"bizzy-lambda/internal/platform/txn"
)

type Status string

const (
	StatusDraft     Status = "draft"
	StatusIssued    Status = "issued"
	StatusCancelled Status = "cancelled"
)

// Type is a kind of document. Each has its own numbering, and an item is
// on at most one live document of each type.
type Type string

const (
	TypeInvoice Type = "invoice"
	TypeReceipt Type = "receipt"
)

// TypeSpec is what differs between document types.
type TypeSpec struct {
	Title string
	// Code starts every number of the type (see Number).
	Code string
	// RecipientLabel heads who it is for, and TotalLabel its total, as
	// printed (see render.go).
	RecipientLabel string
	TotalLabel     string
	// AsksPayment prints where to pay: an invoice asks for a payment, a
	// receipt confirms one.
	AsksPayment bool
}

var Types = map[Type]TypeSpec{
	TypeInvoice: {Title: "Invoice", Code: "INV", RecipientLabel: "Bill to", TotalLabel: "Total", AsksPayment: true},
	TypeReceipt: {Title: "Receipt", Code: "RCP", RecipientLabel: "Received from", TotalLabel: "Total received"},
}

// SourceKind is what a line covers.
type SourceKind string

const (
	SourceSession SourceKind = "session"
	SourcePackage SourceKind = "package"
)

// Source is the item a line covers: a session's fee, or a package.
type Source struct {
	Kind SourceKind `json:"kind"`
	ID   string     `json:"id"`
}

// Key names the source in ids and messages: "session:abc".
func (s Source) Key() string { return string(s.Kind) + ":" + s.ID }

// SessionSource and PackageSource name what a line covers.
func SessionSource(id string) Source { return Source{Kind: SourceSession, ID: id} }
func PackageSource(id string) Source { return Source{Kind: SourcePackage, ID: id} }

type Document struct {
	ID       string `json:"id"`
	Type     Type   `json:"type"`
	Status   Status `json:"status"`
	ClientID string `json:"clientId"`
	// Number and Revision are set on the first issue.
	Number   string `json:"number,omitempty"`
	Revision *int   `json:"revision,omitempty"`
	// Content is the issued content; Draft the one being edited: the
	// first, or the next revision.
	Content *Content `json:"content,omitempty"`
	Draft   *Content `json:"draft,omitempty"`

	CreatedAt    time.Time  `json:"createdAt"`
	IssuedAt     *time.Time `json:"issuedAt,omitempty"`
	CancelledAt  *time.Time `json:"cancelledAt,omitempty"`
	CancelReason string     `json:"cancelReason,omitempty"`
	// ShareToken opens the issued content without signing in (see
	// share.go). Set on the first issue.
	ShareToken string `json:"shareToken,omitempty"`
	// Period is the month (YYYY-MM) a draft invoice gathers a client's
	// sessions for, when they are invoiced by the month; "" when each is
	// invoiced on its own, or put together by hand. Nothing sets it yet:
	// see sessions' invoiceInto.
	Period string `json:"period,omitempty"`
}

// Documents are filed by client, and by type and date for monthly lists.
var Documents = txn.Kind[Document]{
	Name: "DOC", Gone: "This document was deleted.",
	Doc: txn.Doc{What: "An invoice or receipt: its issued content, and the draft being edited.", Client: "its client, by date", Time: "its date (a draft has none until issued)", Tag: "its type (invoice, receipt), by date: the monthly lists"},
	Meta: func(d *Document) txn.Meta {
		return txn.Meta{ID: d.ID, Client: d.ClientID, Time: d.date(), Tag: string(d.Type)}
	},
}

// Content is everything printed on the document. Once issued it never
// changes, so the PDF can be rebuilt exactly years later.
type Content struct {
	// Date is the document date, YYYY-MM-DD; a draft has none until set,
	// and takes the day it is issued.
	Date string `json:"date"`
	// Issuer and Recipient are filled from Settings and the client when a
	// draft is read or issued, unless edited (see Fill).
	Issuer    Issuer    `json:"issuer"`
	Recipient Recipient `json:"recipient"`
	Lines     []Line    `json:"lines"`
	// Payment is how and when what a receipt covers was paid; PaidBy is
	// its method as named ("Cash"), no longer printed.
	Payment    *Payment `json:"payment,omitempty"`
	PaidBy     string   `json:"paidBy,omitempty"`
	Notes      string   `json:"notes,omitempty"`
	TotalCents int64    `json:"totalCents"`
}

// Issuer is the business as printed, copied from Settings.
type Issuer struct {
	Name           string `json:"name"`
	RegistrationNo string `json:"registrationNo,omitempty"`
	Address        string `json:"address,omitempty"`
	Email          string `json:"email,omitempty"`
	Phone          string `json:"phone,omitempty"`
	BankName       string `json:"bankName,omitempty"`
	AccountName    string `json:"accountName,omitempty"`
	AccountNo      string `json:"accountNo,omitempty"`
}

// Recipient is the client as printed, copied from the client: their name
// and IC or passport number. Their contact details are kept as copied, but
// not printed.
type Recipient struct {
	Name    string `json:"name"`
	IDNo    string `json:"idNo,omitempty"`
	Email   string `json:"email,omitempty"`
	Phone   string `json:"phone,omitempty"`
	Address string `json:"address,omitempty"`
}

// Payment is how a receipt's items were paid, and the day.
type Payment struct {
	Method Method `json:"method"`
	PaidOn string `json:"paidOn"`
}

type Line struct {
	// ID keeps a line itself as it moves between drafts and revisions.
	ID          string `json:"id"`
	Description string `json:"description"`
	// Date is the service date, YYYY-MM-DD, if any.
	Date        string  `json:"date,omitempty"`
	AmountCents int64   `json:"amountCents"`
	Source      *Source `json:"source,omitempty"`
	// Typed says the amount was entered for the item (in a title, the
	// form or the draft), not taken from the client's usual fee, which a
	// new usual fee leaves alone.
	Typed bool `json:"typed,omitempty"`
}

// Counting is the content that counts: the draft of one never issued, the
// issued content otherwise (a revision being drafted counts once issued);
// nil for a cancelled one.
func (d *Document) Counting() *Content {
	switch d.Status {
	case StatusDraft:
		return d.Draft
	case StatusIssued:
		return d.Content
	}
	return nil
}

// Live reports whether the document still counts.
func (d *Document) Live() bool { return d.Status != StatusCancelled }

// Issued reports whether it was ever issued: what it says is final.
func (d *Document) Issued() bool { return d.Number != "" }

func (d *Document) date() time.Time {
	c := d.Content
	if c == nil {
		c = d.Draft
	}
	if c == nil || c.Date == "" {
		return time.Time{}
	}
	day, _ := time.Parse(time.DateOnly, c.Date)
	return day
}

// Total adds up the lines.
func (c Content) Total() int64 {
	var total int64
	for _, l := range c.Lines {
		total += l.AmountCents
	}
	return total
}

// Revision is one issued version, kept forever.
type Revision struct {
	DocumentID string    `json:"documentId"`
	Revision   int       `json:"revision"`
	Number     string    `json:"number"`
	Content    Content   `json:"content"`
	IssuedAt   time.Time `json:"issuedAt"`
	// PDFSha256 is the hex SHA-256 of its PDF as issued, which the file
	// store keeps (see pdf.go).
	PDFSha256 string `json:"pdfSha256,omitempty"`
}

var Revisions = txn.Kind[Revision]{
	Name: "DOCREV", Gone: "That revision isn't kept.",
	Doc: txn.Doc{What: "An issued revision, kept as issued: <documentId>#NN. Its PDF is in the file store, at documents/<documentId>/NN.pdf.", Ref: "its document"},
	Meta: func(r *Revision) txn.Meta {
		return txn.Meta{ID: revisionID(r.DocumentID, r.Revision), Ref: r.DocumentID}
	},
}

func revisionID(documentID string, revision int) string {
	return documentID + "#" + Label("", revision)[1:]
}

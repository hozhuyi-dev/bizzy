// Package documents issues business documents (invoices and receipts) with
// a generic lifecycle:
//
//	draft ──issue──▶ issued rev 0 ──revise──▶ (draft on top) ──issue──▶ rev 1 …
//	  │                    │
//	discard             cancel (the number stays used)
//
// A draft is free text she can edit before anything is final, prefilled from
// the session or package it covers. The number is only taken on the first
// issue, so discarded drafts leave no gaps. Every issued revision is kept as
// it was, and the PDF is rendered in the browser from that content.
package documents

import (
	"time"

	"bizzy-lambda/internal/features/docref"
)

type Status string

const (
	StatusDraft     Status = "draft"
	StatusIssued    Status = "issued"
	StatusCancelled Status = "cancelled"
)

// Type is a kind of document. Each has its own numbering sequence, and its
// own slot on the sessions and packages it covers, so one session can have
// both an invoice and a receipt.
type Type string

const (
	TypeInvoice Type = "invoice"
	TypeReceipt Type = "receipt"
)

// TypeSpec is what differs between document types. The content, lifecycle
// and layout are shared.
type TypeSpec struct {
	Title string
	// Code starts every number of the type (see Number).
	Code string
	Slot docref.Slot
}

var Types = map[Type]TypeSpec{
	TypeInvoice: {Title: "Invoice", Code: "INV", Slot: docref.SlotInvoice},
	TypeReceipt: {Title: "Receipt", Code: "RCP", Slot: docref.SlotReceipt},
}

// SourceKind is what a document line was created from.
type SourceKind string

const (
	SourceSession SourceKind = "session"
	SourcePackage SourceKind = "package"
)

type Source struct {
	Kind SourceKind `json:"kind" dynamodbav:"kind"`
	ID   string     `json:"id" dynamodbav:"id"`
}

// Document is the head item: what lists need, plus the latest issued content
// and the draft being edited, if any.
type Document struct {
	ID     string `json:"id" dynamodbav:"id"`
	Type   Type   `json:"type" dynamodbav:"type"`
	Status Status `json:"status" dynamodbav:"status"`
	// Number and Revision are set on the first issue.
	Number   string `json:"number,omitempty" dynamodbav:"number,omitempty"`
	Revision *int   `json:"revision,omitempty" dynamodbav:"revision,omitempty"`
	ClientID string `json:"clientId,omitempty" dynamodbav:"clientId,omitempty"`
	// Date and TotalCents mirror the current content (the draft until it is
	// first issued) for lists.
	Date       string `json:"date" dynamodbav:"date"`
	TotalCents int64  `json:"totalCents" dynamodbav:"totalCents"`
	// Sources are the sessions and packages the issued content covers; each
	// carries a link back here.
	Sources []Source `json:"sources" dynamodbav:"sources"`

	Content *Content `json:"content,omitempty" dynamodbav:"content,omitempty"`
	Draft   *Content `json:"draft,omitempty" dynamodbav:"draft,omitempty"`

	CreatedAt    time.Time  `json:"createdAt" dynamodbav:"createdAt"`
	IssuedAt     *time.Time `json:"issuedAt,omitempty" dynamodbav:"issuedAt,omitempty"`
	CancelledAt  *time.Time `json:"cancelledAt,omitempty" dynamodbav:"cancelledAt,omitempty"`
	CancelReason string     `json:"cancelReason,omitempty" dynamodbav:"cancelReason,omitempty"`
	// ShareToken opens the issued content without signing in (see share.go).
	// Set on the first issue; resetting it kills links already sent.
	ShareToken string `json:"shareToken,omitempty" dynamodbav:"shareToken,omitempty"`
	// Version guards against two tabs editing the same document.
	Version int `json:"version" dynamodbav:"version"`
}

// Summary is a document as a list shows it, without the printed content.
type Summary struct {
	ID         string `json:"id"`
	Type       Type   `json:"type"`
	Status     Status `json:"status"`
	Number     string `json:"number,omitempty"`
	Revision   *int   `json:"revision,omitempty"`
	ClientID   string `json:"clientId,omitempty"`
	Date       string `json:"date"`
	TotalCents int64  `json:"totalCents"`
	// RecipientName is who the current content is for: the issued content,
	// or the draft while it is new.
	RecipientName string `json:"recipientName"`
	// Revising is set while an issued document has a next revision drafted.
	Revising   bool   `json:"revising,omitempty"`
	ShareToken string `json:"shareToken,omitempty"`
}

func (d Document) Summary() Summary {
	s := Summary{
		ID: d.ID, Type: d.Type, Status: d.Status, Number: d.Number, Revision: d.Revision,
		ClientID: d.ClientID, Date: d.Date, TotalCents: d.TotalCents,
		Revising:   d.Status == StatusIssued && d.Draft != nil,
		ShareToken: d.ShareToken,
	}
	switch {
	case d.Content != nil:
		s.RecipientName = d.Content.Recipient.Name
	case d.Draft != nil:
		s.RecipientName = d.Draft.Recipient.Name
	}
	return s
}

// Content is everything printed on the document. Once issued it never
// changes, so the PDF can be rebuilt exactly years later.
type Content struct {
	// Date is the document date, YYYY-MM-DD.
	Date      string    `json:"date" dynamodbav:"date"`
	Issuer    Issuer    `json:"issuer" dynamodbav:"issuer"`
	Recipient Recipient `json:"recipient" dynamodbav:"recipient"`
	Lines     []Line    `json:"lines" dynamodbav:"lines"`
	// PaidBy says how it was paid (cash, bank transfer, DuitNow …).
	PaidBy     string `json:"paidBy,omitempty" dynamodbav:"paidBy,omitempty"`
	Notes      string `json:"notes,omitempty" dynamodbav:"notes,omitempty"`
	TotalCents int64  `json:"totalCents" dynamodbav:"totalCents"`
}

// Issuer is the business as printed, copied from Settings.
type Issuer struct {
	Name           string `json:"name" dynamodbav:"name"`
	RegistrationNo string `json:"registrationNo,omitempty" dynamodbav:"registrationNo,omitempty"`
	Address        string `json:"address,omitempty" dynamodbav:"address,omitempty"`
	Email          string `json:"email,omitempty" dynamodbav:"email,omitempty"`
	Phone          string `json:"phone,omitempty" dynamodbav:"phone,omitempty"`
	BankName       string `json:"bankName,omitempty" dynamodbav:"bankName,omitempty"`
	AccountName    string `json:"accountName,omitempty" dynamodbav:"accountName,omitempty"`
	AccountNo      string `json:"accountNo,omitempty" dynamodbav:"accountNo,omitempty"`
}

// Recipient is the client as printed, copied from the client.
type Recipient struct {
	Name    string `json:"name" dynamodbav:"name"`
	Email   string `json:"email,omitempty" dynamodbav:"email,omitempty"`
	Phone   string `json:"phone,omitempty" dynamodbav:"phone,omitempty"`
	Address string `json:"address,omitempty" dynamodbav:"address,omitempty"`
}

type Line struct {
	Description string `json:"description" dynamodbav:"description"`
	// Date is the service date, YYYY-MM-DD, if any.
	Date        string  `json:"date,omitempty" dynamodbav:"date,omitempty"`
	AmountCents int64   `json:"amountCents" dynamodbav:"amountCents"`
	Source      *Source `json:"source,omitempty" dynamodbav:"source,omitempty"`
}

// Revision is one issued version, kept forever.
type Revision struct {
	DocumentID string    `json:"documentId" dynamodbav:"documentId"`
	Revision   int       `json:"revision" dynamodbav:"revision"`
	Number     string    `json:"number" dynamodbav:"number"`
	Content    Content   `json:"content" dynamodbav:"content"`
	IssuedAt   time.Time `json:"issuedAt" dynamodbav:"issuedAt"`
}

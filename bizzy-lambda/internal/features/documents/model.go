// Package documents issues business documents (receipts for now) with a
// generic lifecycle:
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

import "time"

type Status string

const (
	StatusDraft     Status = "draft"
	StatusIssued    Status = "issued"
	StatusCancelled Status = "cancelled"
)

// Type is a kind of document. Each has its own numbering sequence.
type Type string

const TypeReceipt Type = "receipt"

// TypeSpec is what differs between document types.
type TypeSpec struct {
	Title string
	// DefaultNumbering is used until she sets her own in Settings.
	DefaultNumbering string
}

var Types = map[Type]TypeSpec{
	TypeReceipt: {Title: "Receipt", DefaultNumbering: "RCP-{seq:4}"},
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
	// Version guards against two tabs editing the same document.
	Version int `json:"version" dynamodbav:"version"`
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

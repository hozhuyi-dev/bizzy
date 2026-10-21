import type { PaymentMethod } from "~/features/payments/payments.types";
import type { DOCUMENT_FACETS } from "./documents.constant";
import type { FilterSearch, ListRequest } from "~/core/list/filter.types";
import type { Locks } from "~/core/lambda/lambda.types";

// Mirrors bizzy-lambda/internal/features/documents/api.go and document.go.
// Documents are where money lives: a session's fee is its invoice's line,
// and what was received its receipt's.
export type DocumentType = "invoice" | "receipt";
export type DocumentStatus = "draft" | "issued" | "cancelled";

export interface DocumentSource {
  kind: "session" | "package";
  id: string;
}

export interface Issuer {
  name: string;
  registrationNo?: string;
  address?: string;
  email?: string;
  phone?: string;
  bankName?: string;
  accountName?: string;
  accountNo?: string;
}

export interface Recipient {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface DocumentLine {
  /** Keeps the line itself as it moves between drafts; a new line has none until saved. */
  id: string;
  description: string;
  /** Service date, YYYY-MM-DD. */
  date?: string;
  amountCents: number;
  source?: DocumentSource;
  /** The amount was entered for the item, not taken from the client's usual fee. */
  typed?: boolean;
}

/** How and when what a receipt covers was paid. */
export interface DocumentPayment {
  method: PaymentMethod;
  paidOn: string;
}

/** Everything printed on the document. */
export interface DocumentContent {
  /** A draft has none until the user sets one: it takes the day it is issued. */
  date: string;
  issuer: Issuer;
  recipient: Recipient;
  lines: Array<DocumentLine>;
  /** On a receipt. */
  payment?: DocumentPayment;
  /** The payment as printed ("Cash"). */
  paidBy?: string;
  notes?: string;
  totalCents: number;
}

/** A document as a list shows it, without the printed content; mirrors documents.Summary. */
export interface DocumentSummary {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  number?: string;
  revision?: number;
  clientId: string;
  /** YYYY-MM-DD; a draft has none until set, and takes the day it is issued. */
  date?: string;
  totalCents: number;
  /** Who the current content (issued, or the new draft) is for. */
  recipientName: string;
  /** An issued document with its next revision drafted. */
  revising?: boolean;
  /** Opens the issued content at /d/<token> without signing in. */
  shareToken?: string;
}

/** The invoices or receipts list's filter, as its URL keeps it; their documents' pages take it too. */
export type DocumentsSearch = FilterSearch<(typeof DOCUMENT_FACETS)[number]>;

/** documents.search's request: an empty filter takes every value. */
export interface SearchDocumentsRequest extends ListRequest {
  type: DocumentType;
  clientIds: Array<string>;
  statuses: Array<DocumentStatus>;
}

/** One issued version, kept forever; mirrors documents.Revision. */
export interface DocumentRevision {
  documentId: string;
  revision: number;
  number: string;
  content: DocumentContent;
  issuedAt: string;
}

/**
 * A document as its page shows it: what it prints, the draft as it would be
 * issued now, and every revision issued; mirrors documents.View.
 */
export interface DocumentView extends DocumentSummary {
  /** The latest issued content. */
  content?: DocumentContent;
  /** Being edited: a new document, or the next revision. */
  draft?: DocumentContent;
  createdAt: string;
  issuedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  revisions: Array<DocumentRevision>;
  /** What its draft can't change: on a revision, what has legal weight. */
  locked: Locks;
}

/** What a share link shows: the issued content only; mirrors documents.SharedView. */
export interface SharedDocumentView {
  type: DocumentType;
  status: DocumentStatus;
  number: string;
  revision?: number;
  content: DocumentContent;
  cancelledAt?: string;
}

/** A document a session or package is on; mirrors sessions.DocumentRef. */
export interface DocumentRef {
  id: string;
  /** Set once the document is issued. */
  number?: string;
}

/**
 * A document covering a session or package, as a link to it. A receipt is
 * known by the payment it records, which says whether it is issued and,
 * once it is, its number.
 */
export interface DocumentLink {
  type: DocumentType;
  ref: DocumentRef;
  issued: boolean;
}

/** What differs between document types in the app; see DOCUMENT_TYPES. */
export interface DocumentTypeSpec {
  /** Printed at the top of the PDF. */
  title: string;
  /** Plural, for navigation and lists. */
  plural: string;
  /** Label for the party it is addressed to. */
  recipientLabel: string;
  /** Whether it confirms a payment ("Paid by", "Total paid"); an invoice asks for one. */
  paid: boolean;
  /** Its list, under Documents. */
  path: "/invoices" | "/receipts";
}

/** One printed version of a document. */
export interface DocumentPdfProps {
  type: DocumentType;
  number?: string | undefined;
  revision?: number | undefined;
  /** Printed across the page: a draft, or a cancelled document. */
  watermark?: "DRAFT" | "CANCELLED" | undefined;
  content: DocumentContent;
}

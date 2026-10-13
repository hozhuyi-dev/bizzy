// Mirrors bizzy-lambda/internal/features/documents/model.go.
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
  description: string;
  /** Service date, YYYY-MM-DD. */
  date?: string;
  amountCents: number;
  source?: DocumentSource;
}

/** Everything printed on the document. */
export interface DocumentContent {
  date: string;
  issuer: Issuer;
  recipient: Recipient;
  lines: Array<DocumentLine>;
  paidBy?: string;
  notes?: string;
  totalCents: number;
}

export interface BizDocument {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  number?: string;
  revision?: number;
  clientId?: string;
  date: string;
  totalCents: number;
  sources: Array<DocumentSource>;
  /** The latest issued content. */
  content?: DocumentContent;
  /** Being edited: a new document, or the next revision. */
  draft?: DocumentContent;
  createdAt: string;
  issuedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  /** Opens the issued content at /d/<token> without signing in. */
  shareToken?: string;
  version: number;
}

/**
 * A document as a list shows it, without the printed content. Mirrors
 * Summary in bizzy-lambda/internal/features/documents/model.go.
 */
export interface DocumentSummary {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  number?: string;
  revision?: number;
  clientId?: string;
  date: string;
  totalCents: number;
  /** Who the current content (issued, or the new draft) is for. */
  recipientName: string;
  /** An issued document with its next revision drafted. */
  revising?: boolean;
  shareToken?: string;
}

/**
 * What a share link shows: the issued content only. Mirrors Shared in
 * bizzy-lambda/internal/features/documents/share.go.
 */
export interface SharedDocument {
  type: DocumentType;
  status: DocumentStatus;
  number: string;
  revision?: number;
  content: DocumentContent;
  cancelledAt?: string;
}

export interface DocumentRevision {
  documentId: string;
  revision: number;
  number: string;
  content: DocumentContent;
  issuedAt: string;
}

export interface DocumentDetail {
  document: BizDocument;
  revisions: Array<DocumentRevision>;
}

/** A session's or package's link to a document covering it. */
export interface DocumentRef {
  documentId: string;
  /** Set once the document is issued; a draft only reserves. */
  number?: string;
  revision?: number;
  amountCents?: number;
  date?: string;
  clientId?: string;
}

/** The version she was looking at, so a stale tab can't overwrite. */
export type Versioned = Pick<BizDocument, "id" | "version">;

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

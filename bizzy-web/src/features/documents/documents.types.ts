// Mirrors bizzy-lambda/internal/features/documents/model.go.
export type DocumentType = "receipt";
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
  version: number;
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

export interface Numbering {
  template: string;
  next: string;
  seq: number;
}

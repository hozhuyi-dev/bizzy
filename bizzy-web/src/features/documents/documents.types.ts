import type { PaymentMethod } from "~/features/payments/payments.types";
import type { DOCUMENT_FACETS } from "./documents.constant";
import type { FilterSearch, ListRequest } from "~/core/list/filter.types";
import type { Locks, Verdict } from "~/core/lambda/lambda.types";

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

/** Who pays: name and IC or passport number (or a billing name's registration number) are printed; the contact details are kept, not printed. */
export interface Recipient {
  name: string;
  idNo?: string;
  regNo?: string;
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
  /** On a receipt: how and when what it received was paid. The payment's to change, not the editor's. */
  payment?: DocumentPayment;
  /** Whom its item is for, when that isn't who pays; its item's, not the editor's. */
  for?: { clientId: string; name?: string };
}

/** How and when what a receipt's line received was paid. */
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
  /** Where it is in its lists: its date, a draft's latest service date, else when it was made. */
  filedAt: string;
  totalCents: number;
  /** Who the current content (issued, or the new draft) is for. */
  recipientName: string;
  /** An issued document with its next revision drafted. */
  revising?: boolean;
  /** Opens the issued content at /d/<token> without signing in. */
  shareToken?: string;
  /** What its lines are for, so a list tells documents apart. */
  covers: DocumentCovers;
  /** The clients its lines are for other than who pays (`clientId`): Mum's invoice for Adam's sessions. */
  for: Array<string>;
  /** The same for documents whose drafts can be put on one, each as its `can.moveLines` says. */
  combineKey: string;
  /** What a list's actions on it would say now. */
  can: DocumentSummaryCan;
}

/** How many lines cover sessions, packages and anything else, and their service dates' span; mirrors documents.Covers. */
export interface DocumentCovers {
  sessions: number;
  packages: number;
  other: number;
  /** YYYY-MM-DD; none when no line has a date. */
  from?: string;
  to?: string;
}

/** What a list's actions on a document would say now; mirrors documents.SummaryCan. */
export interface DocumentSummaryCan {
  /** Sending it to the client for their records: issued, and not cancelled. */
  send: Verdict;
  /** Asking the client to pay for it: an invoice with something on it owed. */
  askToPay: Verdict;
  /** Moving its lines, or putting it together with other drafts: a draft never issued. */
  moveLines: Verdict;
}

/**
 * What a message asking to pay says, worked out by the API from what is
 * owed; mirrors documents.Ask.
 */
export interface DocumentAsk {
  clientId: string;
  /** Oldest first. */
  lines: Array<DocumentAskLine>;
  totalCents: number;
  /** What the client types as the transfer's reference: the invoice's number, or "AISYAH 05OCT". */
  ref: string;
}

/** One thing owed: an item as its invoice line says it, or an issued invoice as a whole, with its link. */
export interface DocumentAskLine {
  description: string;
  /** YYYY-MM-DD. */
  date?: string;
  amountCents: number;
  /** An issued invoice's. */
  number?: string;
  revision?: number;
  shareToken?: string;
  /** Whom an item is for, when that isn't who pays. */
  for?: string;
}

/** documents.ask's request: items (a session's sources, a package) and invoices. */
export interface AskDocumentsRequest {
  items?: Array<DocumentSource>;
  ids?: Array<string>;
}

/** What each action on a document would say now, for its page; mirrors documents.Can. */
export interface DocumentCan extends DocumentSummaryCan {
  issue: Verdict;
  /** Billing it to another client: a draft never issued. */
  setPayer: Verdict;
  revise: Verdict;
  cancel: Verdict;
  discardDraft: Verdict;
}

/** The invoices or receipts list's filter, as its URL keeps it; their documents' pages take it too. */
export type DocumentsSearch = FilterSearch<(typeof DOCUMENT_FACETS)[number]>;

/**
 * A document page's search: the list it steps through. Opened from a
 * session's or a package's page (or a row's link to its documents), that
 * one's documents, in the order its page lists them; else the documents
 * list with its filter.
 */
export interface DocumentSearch extends DocumentsSearch {
  session?: string | undefined;
  package?: string | undefined;
  /** Opened from a client's timeline (their id): its documents. */
  timeline?: string | undefined;
}

/** documents.search's request: an empty filter takes every value. */
export interface SearchDocumentsRequest extends ListRequest {
  types: Array<DocumentType>;
  clientIds: Array<string>;
  statuses: Array<DocumentStatus>;
  /** Invoices with something still owed on them. */
  unpaid: boolean;
}

/** One issued version, kept forever; mirrors documents.Revision. */
export interface DocumentRevision {
  documentId: string;
  revision: number;
  number: string;
  content: DocumentContent;
  issuedAt: string;
  /** The SHA-256 of its PDF as issued and kept. */
  pdfSha256: string;
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
  can: DocumentCan;
  /** What its draft can't change: on a revision, what has legal weight. */
  locked: Locks;
}

/** What a share link shows: the issued content and its PDF; mirrors documents.SharedView. */
export interface SharedDocumentView {
  type: DocumentType;
  status: DocumentStatus;
  number: string;
  revision?: number;
  content: DocumentContent;
  cancelledAt?: string;
  pdf: DocumentFile;
}

/**
 * A PDF the API printed; mirrors documents.File. An issued revision's is the
 * file kept when it was issued (stamped CANCELLED once cancelled); a draft's
 * is printed afresh, watermarked DRAFT.
 */
export interface DocumentFile {
  name: string;
  /** The PDF, base64. */
  data: string;
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

/** What differs between document types in the app; see DOCUMENT_TYPES. The API prints them (documents.Types). */
export interface DocumentTypeSpec {
  title: string;
  /** Plural, for navigation and lists. */
  plural: string;
  /** Label for the party it is addressed to. */
  recipientLabel: string;
  /** Label for its total. */
  totalLabel: string;
}

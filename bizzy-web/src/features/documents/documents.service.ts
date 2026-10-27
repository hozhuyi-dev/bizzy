import type {
  AskDocumentsRequest,
  DocumentAsk,
  DocumentContent,
  DocumentFile,
  DocumentSource,
  DocumentSummary,
  DocumentType,
  DocumentView,
  SearchDocumentsRequest,
  SharedDocumentView,
} from "./documents.types";
import type { Page } from "~/core/list/filter.types";
import type { ApiResponse } from "~/core/lambda/lambda.types";
import { ApiError, invoke } from "~/core/lambda/lambda.client";

export const DocumentsService = {
  /** A page of the documents of a type found, latest first, drafts without a date last. */
  search: (request: SearchDocumentsRequest) => invoke<Page<DocumentSummary>>("documents.search", request),
  /** Every document for a client, of any type, latest first (a draft without a date by when it was made). */
  listByClient: (clientId: string) =>
    invoke<Array<DocumentSummary>>("documents.listByClient", { clientId }),
  /** The document with every revision issued. */
  get: (id: string) => invoke<DocumentView>("documents.get", { id }),
  saveDraft: (id: string, content: DocumentContent) =>
    invoke<DocumentView | null>("documents.saveDraft", { id, content }),
  issue: (id: string) => invoke<DocumentView | null>("documents.issue", { id }),
  /** An issued revision's PDF as kept (undefined: the latest), stamped CANCELLED once cancelled. */
  pdf: (id: string, revision?: number) => invoke<DocumentFile>("documents.pdf", { id, revision }),
  /** A draft's PDF as it would be issued now, from the content on screen, saved or not. */
  preview: (id: string, content: DocumentContent) => invoke<DocumentFile>("documents.preview", { id, content }),
  revise: (id: string) => invoke<DocumentView | null>("documents.revise", { id }),
  /**
   * Moves lines to another draft of the client's (to = undefined: a new
   * one): to put several sessions on one invoice, or one on its own.
   */
  moveLines: (from: string, to: string | undefined, lineIds: Array<string>) =>
    invoke<null>("documents.moveLines", { from, to: to ?? "", lineIds }),
  /**
   * Puts every line of the drafts after the first on the first, and they
   * go: a client's sessions on one invoice.
   */
  combine: (ids: Array<string>) => invoke<DocumentView | null>("documents.combine", { ids }),
  /**
   * Puts the lines of a type covering items on the draft into (undefined:
   * a new one), from the drafts they are on: to add sessions to an invoice.
   */
  place: (type: DocumentType, into: string | undefined, items: Array<DocumentSource>) =>
    invoke<DocumentView | null>("documents.place", { type, into: into ?? "", items }),
  /**
   * Bills a draft never issued to another client, its recipient filled
   * again from them; an invoice's payments not on an issued receipt move
   * with it.
   */
  setPayer: (id: string, clientId: string) => invoke<DocumentView | null>("documents.setPayer", { id, clientId }),
  /** Null when a never-issued draft goes: a receipt, with its payment. */
  discardDraft: (id: string) => invoke<DocumentView | null>("documents.discardDraft", { id }),
  cancel: (id: string, reason: string) => invoke<DocumentView | null>("documents.cancel", { id, reason }),
  /** What a message asking to pay for items and invoices says; refused when nothing on them is owed. */
  ask: (request: AskDocumentsRequest) => invoke<DocumentAsk>("documents.ask", request),
  /** The issued documents covering items, invoices first; refused when none is. */
  records: (items: Array<DocumentSource>) => invoke<Array<DocumentSummary>>("documents.records", { items }),
  /** Share tokens by id, giving one to any issued document without. */
  share: (ids: Array<string>) => invoke<Record<string, string>>("documents.share", { ids }),
  /** A new share token: links already sent stop working. */
  resetShare: (id: string) => invoke<DocumentView | null>("documents.resetShare", { id }),
  /** A shared document, for anyone with the link: no sign-in. */
  readShared: async (token: string): Promise<SharedDocumentView> => {
    const base = import.meta.env.VITE_PUBLIC_URL.replace(/\/$/, "");
    const response = await fetch(`${base}/${encodeURIComponent(token)}`);
    const body = (await response.json()) as ApiResponse<SharedDocumentView>;
    if (!body.data) {
      throw new ApiError(body.error?.code ?? "internal", body.error?.message ?? "Something went wrong.");
    }
    return body.data;
  },
};

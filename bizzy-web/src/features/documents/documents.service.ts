import type { DocumentContent, DocumentSummary, DocumentType, DocumentView, SharedDocumentView } from "./documents.types";
import type { ApiResponse } from "~/core/lambda/lambda.types";
import { ApiError, invoke } from "~/core/lambda/lambda.client";

export const DocumentsService = {
  /** One month ("2026-10") of one type. */
  list: (type: DocumentType, month: string) =>
    invoke<Array<DocumentSummary>>("documents.list", { type, month }),
  /** Every document for a client, of any type, newest first, the drafts last. */
  listByClient: (clientId: string) =>
    invoke<Array<DocumentSummary>>("documents.listByClient", { clientId }),
  /** The document with every revision issued. */
  get: (id: string) => invoke<DocumentView>("documents.get", { id }),
  saveDraft: (id: string, content: DocumentContent) =>
    invoke<DocumentView | null>("documents.saveDraft", { id, content }),
  issue: (id: string) => invoke<DocumentView | null>("documents.issue", { id }),
  revise: (id: string) => invoke<DocumentView | null>("documents.revise", { id }),
  /**
   * Moves lines to another draft of the client's (to = undefined: a new
   * one): to put several sessions on one invoice, or one on its own.
   */
  moveLines: (from: string, to: string | undefined, lineIds: Array<string>) =>
    invoke<null>("documents.moveLines", { from, to: to ?? "", lineIds }),
  /** Null when a never-issued draft goes: a receipt, with its payment. */
  discardDraft: (id: string) => invoke<DocumentView | null>("documents.discardDraft", { id }),
  cancel: (id: string, reason: string) => invoke<DocumentView | null>("documents.cancel", { id, reason }),
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

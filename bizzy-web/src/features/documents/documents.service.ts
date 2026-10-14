import type {
  BizDocument,
  DocumentContent,
  DocumentDetail,
  DocumentSummary,
  DocumentType,
  SharedDocument,
  Versioned,
} from "./documents.types";
import type { ApiResponse } from "~/core/lambda/lambda.types";
import { ApiError, invoke } from "~/core/lambda/lambda.client";

export const DocumentsService = {
  /** One month ("2026-10") of one type, newest first. */
  list: (type: DocumentType, month: string) =>
    invoke<Array<DocumentSummary>>("documents.list", { type, month }),
  /** Every document for a client, of any type, newest first. */
  listByClient: (clientId: string) =>
    invoke<Array<DocumentSummary>>("documents.listByClient", { clientId }),
  get: (id: string) => invoke<DocumentDetail>("documents.get", { id }),
  saveDraft: (doc: Versioned, content: DocumentContent) =>
    invoke<BizDocument>("documents.saveDraft", { id: doc.id, version: doc.version, content }),
  issue: (doc: Versioned) =>
    invoke<BizDocument>("documents.issue", { id: doc.id, version: doc.version }),
  revise: (doc: Versioned) =>
    invoke<BizDocument>("documents.revise", { id: doc.id, version: doc.version }),
  /**
   * Moves lines to another draft of the client's (to = undefined: a new
   * one): to put several sessions on one invoice, or one on its own.
   */
  moveLines: (from: string, to: string | undefined, lineIds: Array<string>) =>
    invoke<null>("documents.moveLines", { from, to, lineIds }),
  /** Null when a never-issued draft goes: a receipt, with its payment. */
  discardDraft: (doc: Versioned) =>
    invoke<BizDocument | null>("documents.discardDraft", { id: doc.id, version: doc.version }),
  cancel: (doc: Versioned, reason: string) =>
    invoke<BizDocument>("documents.cancel", { id: doc.id, version: doc.version, reason }),
  /** Share tokens by id, giving one to any issued document without. */
  share: (ids: Array<string>) => invoke<Record<string, string>>("documents.share", { ids }),
  /** A new share token: links already sent stop working. */
  resetShare: (doc: Versioned) =>
    invoke<BizDocument>("documents.resetShare", { id: doc.id, version: doc.version }),
  /** A shared document, for anyone with the link: no sign-in. */
  readShared: async (token: string): Promise<SharedDocument> => {
    const base = import.meta.env.VITE_PUBLIC_URL.replace(/\/$/, "");
    const response = await fetch(`${base}/${encodeURIComponent(token)}`);
    const body = (await response.json()) as ApiResponse<SharedDocument>;
    if (!body.data) {
      throw new ApiError(body.error?.code ?? "internal", body.error?.message ?? "Something went wrong.");
    }
    return body.data;
  },
};

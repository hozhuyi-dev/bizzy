import type {
  BizDocument,
  DocumentContent,
  DocumentDetail,
  DocumentSource,
  DocumentSummary,
  DocumentType,
  Numbering,
  SharedDocument,
} from "./documents.types";
import { ApiError, invoke } from "~/core/lambda/lambda.client";

/** The version she was looking at, so a stale tab can't overwrite. */
export type Versioned = Pick<BizDocument, "id" | "version">;

export const DocumentsService = {
  /** One month ("2026-10") of one type, newest first. */
  list: (type: DocumentType, month: string) =>
    invoke<Array<DocumentSummary>>("documents.list", { type, month }),
  /** Every document for a client, of any type, newest first. */
  listByClient: (clientId: string) =>
    invoke<Array<DocumentSummary>>("documents.listByClient", { clientId }),
  get: (id: string) => invoke<DocumentDetail>("documents.get", { id }),
  createDraft: (type: DocumentType, sources: Array<DocumentSource>) =>
    invoke<BizDocument>("documents.createDraft", { type, sources }),
  saveDraft: (doc: Versioned, content: DocumentContent) =>
    invoke<BizDocument>("documents.saveDraft", { id: doc.id, version: doc.version, content }),
  issue: (doc: Versioned) =>
    invoke<BizDocument>("documents.issue", { id: doc.id, version: doc.version }),
  revise: (doc: Versioned) =>
    invoke<BizDocument>("documents.revise", { id: doc.id, version: doc.version }),
  /** Null when a never-issued draft is deleted outright. */
  discardDraft: (doc: Versioned) =>
    invoke<BizDocument | null>("documents.discardDraft", { id: doc.id, version: doc.version }),
  cancel: (doc: Versioned, reason: string) =>
    invoke<BizDocument>("documents.cancel", { id: doc.id, version: doc.version, reason }),
  numbering: (type: DocumentType) => invoke<Numbering>("documents.numbering", { type }),
  setNextNumber: (type: DocumentType, next: number) =>
    invoke<Numbering>("documents.setNextNumber", { type, next }),
  /** Share tokens by id, giving one to any issued document without. */
  share: (ids: Array<string>) => invoke<Record<string, string>>("documents.share", { ids }),
  /** A new share token: links already sent stop working. */
  resetShare: (doc: Versioned) =>
    invoke<BizDocument>("documents.resetShare", { id: doc.id, version: doc.version }),
  /** A shared document, for anyone with the link: no sign-in. */
  readShared: async (token: string): Promise<SharedDocument> => {
    const base = import.meta.env.VITE_PUBLIC_URL.replace(/\/$/, "");
    const response = await fetch(`${base}/${encodeURIComponent(token)}`);
    const body = (await response.json()) as {
      data?: SharedDocument;
      error?: { code: string; message: string };
    };
    if (!body.data) {
      throw new ApiError(body.error?.code ?? "internal", body.error?.message ?? "Something went wrong.");
    }
    return body.data;
  },
};

/** The link that opens a shared document, on whichever origin the app runs. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/d/${token}`;
}

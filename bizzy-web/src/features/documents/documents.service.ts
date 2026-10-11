import type {
  BizDocument,
  DocumentContent,
  DocumentDetail,
  DocumentSource,
  DocumentType,
  Numbering,
} from "./documents.types";
import { invoke } from "~/core/lambda/lambda.client";

/** The version she was looking at, so a stale tab can't overwrite. */
export type Versioned = Pick<BizDocument, "id" | "version">;

export const DocumentsService = {
  list: (type: DocumentType) => invoke<Array<BizDocument>>("documents.list", { type }),
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
};

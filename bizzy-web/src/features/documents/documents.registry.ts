import type { BizDocument, DocumentContent, DocumentType } from "./documents.types";

/**
 * What differs between document types in the app. Adding a type (quotation,
 * credit note …) is an entry here plus one in the API's documents.Types; the
 * lifecycle, editor and PDF layout are shared.
 */
export interface DocumentTypeSpec {
  /** Printed at the top of the PDF. */
  title: string;
  /** Plural, for navigation and lists. */
  plural: string;
  /** Label for the party it is addressed to. */
  recipientLabel: string;
  /** Whether "Paid by" applies. */
  paid: boolean;
}

export const DOCUMENT_TYPES: Record<DocumentType, DocumentTypeSpec> = {
  receipt: {
    title: "Receipt",
    plural: "Receipts",
    recipientLabel: "Received from",
    paid: true,
  },
};

/** "RCP-0001", "RCP-0001 Rev 01"; the first revision shows no label. */
export function documentLabel(number: string | undefined, revision: number | undefined): string {
  if (!number) return "Draft";
  return revision ? `${number} Rev ${String(revision).padStart(2, "0")}` : number;
}

/** The content a reader sees: the draft while it is new, else the issued one. */
export function currentContent(doc: BizDocument): DocumentContent | undefined {
  return doc.content ?? doc.draft;
}

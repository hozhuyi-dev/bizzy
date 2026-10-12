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
  /** Whether it confirms a payment ("Paid by", "Total paid"); an invoice asks for one. */
  paid: boolean;
  /** Its list, under Documents. */
  path: "/invoices" | "/receipts";
}

export const DOCUMENT_TYPES: Record<DocumentType, DocumentTypeSpec> = {
  invoice: {
    title: "Invoice",
    plural: "Invoices",
    recipientLabel: "Bill to",
    paid: false,
    path: "/invoices",
  },
  receipt: {
    title: "Receipt",
    plural: "Receipts",
    recipientLabel: "Received from",
    paid: true,
    path: "/receipts",
  },
};

/** The route of one document's page. */
export function documentRoute(type: DocumentType) {
  return type === "invoice" ? ("/invoices/$id" as const) : ("/receipts/$id" as const);
}

/** "RCP260042-00": the number and its revision, from -00. A draft has no number yet. */
export function documentLabel(number: string | undefined, revision: number | undefined): string {
  if (!number) return "Draft";
  return `${number}-${String(revision ?? 0).padStart(2, "0")}`;
}

/** The content a reader sees: the draft while it is new, else the issued one. */
export function currentContent(doc: BizDocument): DocumentContent | undefined {
  return doc.content ?? doc.draft;
}

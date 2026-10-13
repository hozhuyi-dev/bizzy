import type { DocumentStatus, DocumentType, DocumentTypeSpec } from "./documents.types";

/**
 * What differs between document types in the app. Adding a type (quotation,
 * credit note …) is an entry here plus one in the API's documents.Types; the
 * lifecycle, editor and PDF layout are shared.
 */
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

export const DOCUMENT_STATUS: Record<DocumentStatus, { label: string; variant: "waiting" | "done" | "neutral" }> = {
  draft: { label: "Draft", variant: "waiting" },
  issued: { label: "Issued", variant: "done" },
  cancelled: { label: "Cancelled", variant: "neutral" },
};

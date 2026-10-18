import { DOCUMENT_TYPES } from "./documents.constant";
import type { DocumentLink, DocumentRef, DocumentType } from "./documents.types";
import type { Paid } from "~/features/payments/payments.types";

/** The route of one document's page. */
export function documentRoute(type: DocumentType) {
  return type === "invoice" ? ("/invoices/$id" as const) : ("/receipts/$id" as const);
}

/** "RCP260042-00": the number and its revision, from -00. A draft has no number yet. */
export function documentLabel(number: string | undefined, revision: number | undefined): string {
  if (!number) return "Draft";
  return `${number}-${String(revision ?? 0).padStart(2, "0")}`;
}

/**
 * How a link to a document reads: its number, or what it is when the link
 * doesn't know it ("Receipt", known by the payment it records) or it has
 * none yet ("Draft invoice").
 */
export function refLabel(type: DocumentType, ref: DocumentRef, issued = Boolean(ref.number)): string {
  if (ref.number) return ref.number;
  const { title } = DOCUMENT_TYPES[type];
  return issued ? title : `Draft ${title.toLowerCase()}`;
}

/** Something documents cover: a session or a package, with its invoice and payment. */
interface Covered {
  invoice?: DocumentRef | undefined;
  paid?: Paid | undefined;
}

/** The invoice and the receipt covering an item, those it has. */
export function coveringDocuments(item: Covered | undefined): Array<DocumentLink> {
  const links: Array<DocumentLink> = [];
  if (item?.invoice) links.push({ type: "invoice", ref: item.invoice, issued: Boolean(item.invoice.number) });
  if (item?.paid) links.push({ type: "receipt", ref: { id: item.paid.receiptId }, issued: item.paid.issued });
  return links;
}

/** The link that opens a shared document, on whichever origin the app runs. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/d/${token}`;
}

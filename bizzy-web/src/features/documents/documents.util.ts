import { DOCUMENT_FACETS, DOCUMENT_STATUS, DOCUMENT_TYPES } from "./documents.constant";
import type {
  DocumentLink,
  DocumentRef,
  DocumentStatus,
  DocumentSummary,
  DocumentType,
  SearchDocumentsRequest,
} from "./documents.types";
import type { Paid } from "~/features/payments/payments.types";
import type { ClientView } from "~/features/clients/clients.types";
import type { Facet, ListFilter } from "~/core/list/filter.types";
import type { Place } from "~/core/list/pager.types";
import { clientFacet } from "~/features/clients/clients.util";
import { filterUrl, listRequest } from "~/core/list/filter.util";
import { monthKey } from "~/core/utils/date.util";

/** The invoices and receipts lists' filter in their URLs: this month unless it says otherwise. */
export const documentsUrl = filterUrl(DOCUMENT_FACETS, () => monthKey(new Date()));

/** Where a document sits in its list: by its date; a draft without one, last. */
export function documentPlace(doc: DocumentSummary): Place {
  return { at: doc.date ? Date.parse(doc.date) : -Infinity, id: doc.id };
}

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
 * doesn't know it ("Receipt", from an API without the receipt's number) or
 * it has none yet ("Draft invoice").
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
  if (item?.paid) {
    const { receiptId, receiptNumber, issued } = item.paid;
    links.push({ type: "receipt", ref: receiptNumber ? { id: receiptId, number: receiptNumber } : { id: receiptId }, issued });
  }
  return links;
}

/** The link that opens a shared document, on whichever origin the app runs. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/d/${token}`;
}

/** What the invoices and receipts lists can be narrowed by (DOCUMENT_FACETS). */
export function documentFacets(clients: ReadonlyArray<ClientView>): Array<Facet> {
  return [
    clientFacet(clients),
    {
      key: "status",
      label: "Status",
      options: Object.entries(DOCUMENT_STATUS).map(([value, status]) => ({ value, label: status.label })),
    },
  ];
}

/** The search the filter asks the API for. */
export function searchDocumentsRequest(type: DocumentType, filter: ListFilter): SearchDocumentsRequest {
  return {
    ...listRequest(filter),
    type,
    clientIds: [...(filter.chips.client ?? [])],
    statuses: [...(filter.chips.status ?? [])] as Array<DocumentStatus>,
  };
}

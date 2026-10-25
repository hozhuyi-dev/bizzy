import { DOCUMENT_FACETS, DOCUMENT_STATUS, DOCUMENT_TYPES } from "./documents.constant";
import type {
  DocumentCovers,
  DocumentFile,
  DocumentLink,
  DocumentRef,
  DocumentSearch,
  DocumentStatus,
  DocumentSummary,
  DocumentType,
  SearchDocumentsRequest,
} from "./documents.types";
import type { Paid } from "~/features/payments/payments.types";
import type { ClientView } from "~/features/clients/clients.types";
import type { Facet, FilterPreset, ListFilter } from "~/core/list/filter.types";
import type { Place } from "~/core/list/pager.types";
import { clientFacet } from "~/features/clients/clients.util";
import { NO_FILTER, filterUrl, listRequest } from "~/core/list/filter.util";
import { formatSpan, monthKey } from "~/core/utils/date.util";
import { textParam } from "~/core/utils/url-param.util";
import { formatCents } from "~/core/utils/money.util";

/** The documents list's filter in its URL: this month unless it says otherwise. */
export const documentsUrl = filterUrl(DOCUMENT_FACETS, () => monthKey(new Date()));

/** The search a document's page takes: the list it steps through. */
export function validateDocumentSearch(search: Record<string, unknown>): DocumentSearch {
  return {
    ...documentsUrl.validate(search),
    session: textParam(search.session),
    package: textParam(search.package),
    timeline: textParam(search.timeline),
  };
}

/** The documents list, with a filter: where a document's page goes back to. */
export function documentsLink(filter: ListFilter) {
  return { to: "/documents", label: "Documents", search: documentsUrl.toSearch(filter) } as const;
}

/**
 * A client's documents, at any time, narrowed as their page's section is:
 * what a document opened from their page steps through, in the same order.
 */
export function clientDocumentsSearch(clientId: string, chips: ListFilter["chips"] = {}): DocumentSearch {
  return documentsUrl.toSearch({ ...NO_FILTER, chips: { ...chips, client: [clientId] } });
}

/**
 * The client a filter is for, when it narrows by nothing but them and by
 * type and status: then their documents, read whole for their page, answer
 * it (see documentsOfClient), in the same order.
 */
export function oneClientOf(filter: ListFilter): string | undefined {
  const { client = [], payment = [] } = filter.chips;
  return client.length === 1 && payment.length === 0 && !filter.when && !filter.text.trim() ? client[0] : undefined;
}

/** A client's documents of the types and statuses the chips name (any, for none). */
export function documentsOfClient(docs: ReadonlyArray<DocumentSummary>, chips: ListFilter["chips"]): Array<DocumentSummary> {
  const { type = [], status = [] } = chips;
  return docs.filter((doc) => (type.length === 0 || type.includes(doc.type)) && (status.length === 0 || status.includes(doc.status)));
}

/** Where a document sits in its list, as the API files it. */
export function documentPlace(doc: Pick<DocumentSummary, "id" | "filedAt">): Place {
  return { at: Date.parse(doc.filedAt), id: doc.id };
}

/** The route of one document's page. */
export function documentRoute(type: DocumentType) {
  return type === "invoice" ? ("/invoices/$id" as const) : ("/receipts/$id" as const);
}

/** A PDF from the API (DocumentFile.data, base64), as its bytes. */
export function pdfBytes(data: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
}

/** A PDF from the API, as the browser opens or saves it. */
export function pdfBlob(file: DocumentFile): Blob {
  return new Blob([pdfBytes(file.data)], { type: "application/pdf" });
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

/** How far an item's invoice or receipt has got: none yet, a draft, or issued. Mirrors sessions.Paperwork. */
export type Paperwork = "none" | "draft" | "issued";

/** How far an item's invoice, and its receipt, have got. */
export function paperworkOf(item: Covered): Record<DocumentType, Paperwork> {
  const { invoice, paid } = item;
  return {
    invoice: invoice ? (invoice.number ? "issued" : "draft") : "none",
    receipt: paid ? (paid.issued ? "issued" : "draft") : "none",
  };
}

/** A list's chip for how far its items' invoices (or receipts) have got: "Invoice: issued". */
export function paperworkFacet(type: DocumentType): Facet {
  const { title } = DOCUMENT_TYPES[type];
  const options: Array<{ value: Paperwork; label: string }> = [
    { value: "none", label: `No ${title.toLowerCase()}` },
    { value: "draft", label: `${title} not issued` },
    { value: "issued", label: `${title} issued` },
  ];
  return { key: type, label: title, options };
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

/**
 * What a document's lines are for, to tell it from others in a list:
 * "Session, 5 Oct", "3 sessions, 5–19 Oct", "2 sessions, 1 package, 28 Sept – 19 Oct".
 */
export function coversText({ sessions, packages, other, from, to }: DocumentCovers): string {
  const counts: Array<[number, string]> = [
    [sessions, "session"],
    [packages, "package"],
    [other, "item"],
  ];
  const kinds = counts.filter(([n]) => n > 0);
  const [only] = kinds;
  const what =
    kinds.length === 0
      ? "No lines"
      : kinds.length === 1 && only?.[0] === 1
        ? only[1].charAt(0).toUpperCase() + only[1].slice(1)
        : kinds.map(([n, noun]) => `${n} ${noun}${n === 1 ? "" : "s"}`).join(", ");
  return from && to ? `${what}, ${formatSpan(from, to)}` : what;
}

/** The link that opens a shared document, on whichever origin the app runs. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/d/${token}`;
}

export const DOCUMENT_TYPE_FACET: Facet = {
  key: "type",
  label: "Type",
  options: Object.entries(DOCUMENT_TYPES).map(([value, spec]) => ({ value, label: spec.plural })),
};

export const DOCUMENT_STATUS_FACET: Facet = {
  key: "status",
  label: "Status",
  options: Object.entries(DOCUMENT_STATUS).map(([value, status]) => ({ value, label: status.label })),
};

/** What the documents list can be narrowed by (DOCUMENT_FACETS). */
export function documentFacets(clients: ReadonlyArray<ClientView>): Array<Facet> {
  return [
    DOCUMENT_TYPE_FACET,
    clientFacet(clients),
    DOCUMENT_STATUS_FACET,
    {
      key: "payment",
      label: "Payment",
      single: true,
      options: [{ value: "unpaid", label: "Unpaid", keywords: ["owed", "owes"] }],
    },
  ];
}

/** The ways the documents list is usually looked at; this month first, as it opens. */
export function documentPresets(now = new Date()): Array<FilterPreset> {
  return [
    { label: "This month", when: monthKey(now), chips: {} },
    { label: "Unpaid invoices", when: undefined, chips: { type: ["invoice"], payment: ["unpaid"] } },
    { label: "Drafts", when: undefined, chips: { status: ["draft"] } },
    { label: "Receipts this year", when: String(now.getFullYear()), chips: { type: ["receipt"] } },
  ];
}

/**
 * What the ticked are, under their count: whose, then how many of each
 * type ("2 invoices, 1 receipt"), with what they come to when all are of
 * one type, as an invoice's and a receipt's totals don't add up to anything.
 */
export function tickedSummary(chosen: ReadonlyArray<DocumentSummary>, clientName: string): string {
  const types = (["invoice", "receipt"] as const)
    .map((type) => ({ type, docs: chosen.filter((doc) => doc.type === type) }))
    .filter(({ docs }) => docs.length > 0);
  const counts = types
    .map(({ type, docs }) => {
      const spec = DOCUMENT_TYPES[type];
      return `${docs.length} ${(docs.length === 1 ? spec.title : spec.plural).toLowerCase()}`;
    })
    .join(", ");
  const [only] = types;
  const total =
    types.length === 1 && only ? ` · ${formatCents(only.docs.reduce((sum, doc) => sum + doc.totalCents, 0))}` : "";
  return [clientName, counts].filter(Boolean).join(" · ") + total;
}

/** The search the filter asks the API for. */
export function searchDocumentsRequest(filter: ListFilter): SearchDocumentsRequest {
  return {
    ...listRequest(filter),
    types: [...(filter.chips.type ?? [])] as Array<DocumentType>,
    clientIds: [...(filter.chips.client ?? [])],
    statuses: [...(filter.chips.status ?? [])] as Array<DocumentStatus>,
    unpaid: filter.chips.payment?.includes("unpaid") ?? false,
  };
}

import { FileTextIcon, LinkIcon, ReceiptIcon } from "lucide-react";
import { toast } from "sonner";
import { DOCUMENT_STATUS, DOCUMENT_TYPES } from "./documents.constant";
import { coversText, documentLabel, documentRoute, shareUrl } from "./documents.util";
import type { LinkOptions } from "@tanstack/react-router";
import type { DocumentStatus, DocumentSummary, DocumentType, DocumentsSearch } from "./documents.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { ClientView } from "~/features/clients/clients.types";
import { Badge } from "~/components/ui/badge";
import { Checkbox } from "~/components/ui/checkbox";
import { CellText } from "~/components/shared/list/data-table/data-table-cell.component";
import { createDataTableColumnHelper } from "~/components/shared/list/data-table/data-table.config";
import { DataCard } from "~/components/shared/list/data-card/data-card.component";
import { RowActions } from "~/components/shared/actions/row-actions/row-actions.component";
import { TextLink } from "~/components/shared/link/text-link/text-link.component";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";

export function DocumentStatusBadge({ status, revising }: { status: DocumentStatus; revising?: boolean | undefined }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant={DOCUMENT_STATUS[status].variant}>{DOCUMENT_STATUS[status].label}</Badge>
      {revising && <Badge variant="waiting">Revising</Badge>}
    </span>
  );
}

/** The document's page, with the list it steps through. */
export function documentLink(doc: Pick<DocumentSummary, "id" | "type">, search?: DocumentsSearch): LinkOptions {
  return { to: documentRoute(doc.type), params: { id: doc.id }, search: search ?? {} };
}

/** A draft takes the day it is issued. */
function dateText(doc: DocumentSummary): string {
  return doc.date ? formatDate(doc.date) : "Dated when issued";
}

/** What the Date column says of a draft: the day it is listed by (its latest session or package), as it has none of its own yet. */
function draftDateText(doc: DocumentSummary): string {
  return doc.covers.to ? `For ${formatDate(doc.covers.to)}` : "Dated when issued";
}

/**
 * Copy link, to send an issued document from the list; the rest (WhatsApp,
 * PDF, reset the link) is on its page. A draft's link shows nothing yet.
 */
export function documentActions(doc: DocumentSummary): Array<Action> {
  const token = doc.shareToken;
  if (!doc.can.send.ok || !token) return [];
  return [
    {
      type: "button",
      label: "Copy link",
      icon: LinkIcon,
      onClick: () =>
        void navigator.clipboard
          .writeText(shareUrl(token))
          .then(() => toast.success("Link copied"))
          .catch(() => toast.error("Couldn't copy the link")),
    },
  ];
}

/** "Invoice INV-2026-0012-00", or "Draft invoice": a document, of either type. */
export function documentName(doc: DocumentSummary): string {
  const title = DOCUMENT_TYPES[doc.type].title;
  return doc.number ? `${title} ${documentLabel(doc.number, doc.revision)}` : `Draft ${title.toLowerCase()}`;
}

/** An invoice's or a receipt's icon, beside its name or type, which say it in words. */
export function DocumentTypeIcon({ type }: { type: DocumentType }) {
  const Icon = type === "invoice" ? FileTextIcon : ReceiptIcon;
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

const helper = createDataTableColumnHelper<DocumentSummary>();

/**
 * Its date, by which the lists come, latest first (see documentPlace): a
 * draft, dated when issued, by its latest session or package, so it sits
 * with what it is for.
 */
export const documentDateColumn = helper.accessor("filedAt", {
  id: "date",
  header: "Date",
  meta: { ordered: "desc", search: (doc: DocumentSummary) => (doc.date ? formatDate(doc.date) : draftDateText(doc)) },
  cell: ({ row }) =>
    row.original.date ? (
      formatDate(row.original.date)
    ) : (
      <span className="text-muted-foreground">{draftDateText(row.original)}</span>
    ),
});

/** A tick on each document something can be done with (see canTick), and one ticking them all. */
export const documentTickColumn = helper.display({
  id: "select",
  header: ({ table }) => (
    <Checkbox
      aria-label="Tick every document"
      checked={table.getIsAllRowsSelected()}
      indeterminate={table.getIsSomeRowsSelected()}
      onCheckedChange={(checked) => table.toggleAllRowsSelected(checked)}
    />
  ),
  meta: { width: "fit" },
  cell: ({ row }) => (
    <Checkbox
      aria-label={`Tick ${documentName(row.original)}`}
      disabled={!row.getCanSelect()}
      checked={row.getIsSelected()}
      onCheckedChange={(checked) => row.toggleSelected(checked)}
    />
  ),
});

/** The client's name, else who it is addressed to (a client not loaded yet). */
function clientNameOf(doc: DocumentSummary, clientsById: ReadonlyMap<string, ClientView>): string {
  return clientsById.get(doc.clientId)?.name ?? doc.recipientName;
}

/** Who it is addressed to, when that isn't the client by name (a parent, an insurer). */
function addressedTo(doc: DocumentSummary, clientsById: ReadonlyMap<string, ClientView>): string | undefined {
  return doc.recipientName && doc.recipientName !== clientNameOf(doc, clientsById) ? `To ${doc.recipientName}` : undefined;
}

/** Whose document it is, linking to the client's page; the row opens the document's. */
function DocumentClient({ doc, clientsById }: { doc: DocumentSummary; clientsById: ReadonlyMap<string, ClientView> }) {
  const client = clientsById.get(doc.clientId);
  if (!client) return <span className="font-medium">{doc.recipientName}</span>;
  return (
    <TextLink to="/clients/$id" params={{ id: client.id }}>
      {client.name}
    </TextLink>
  );
}

/**
 * The table's columns; `search` is the list's filter, for each document's
 * page to step through. With `ticking`, a tick column first.
 */
export const createDocumentColumns = (
  search: DocumentsSearch | undefined,
  clientsById: ReadonlyMap<string, ClientView>,
  ticking = false,
) =>
  helper.columns([
    ...(ticking ? [documentTickColumn] : []),
    helper.accessor("type", {
      header: "Type",
      sortFn: "alphanumeric",
      meta: { search: (doc: DocumentSummary) => DOCUMENT_TYPES[doc.type].title },
      cell: ({ getValue }) => (
        <span className="flex items-center gap-2">
          <DocumentTypeIcon type={getValue()} />
          {DOCUMENT_TYPES[getValue()].title}
        </span>
      ),
    }),
    helper.accessor((doc) => doc.number ?? "", {
      id: "number",
      header: "No.",
      sortFn: "alphanumeric",
      meta: { search: (doc: DocumentSummary) => documentLabel(doc.number, doc.revision) },
      cell: ({ row }) => <span className="font-medium">{documentLabel(row.original.number, row.original.revision)}</span>,
    }),
    documentDateColumn,
    helper.accessor((doc) => clientNameOf(doc, clientsById), {
      id: "client",
      header: "Client",
      sortFn: "alphanumeric",
      meta: {
        width: "grow",
        search: (doc: DocumentSummary) => [clientNameOf(doc, clientsById), doc.recipientName, coversText(doc.covers)],
      },
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <CellText sub={[addressedTo(doc, clientsById), coversText(doc.covers)].filter(Boolean).join(" · ")}>
            <DocumentClient doc={doc} clientsById={clientsById} />
          </CellText>
        );
      },
    }),
    helper.accessor("status", {
      header: "Status",
      sortFn: "alphanumeric",
      meta: {
        search: (doc: DocumentSummary) => [DOCUMENT_STATUS[doc.status].label, doc.revising ? "Revising" : undefined],
      },
      cell: ({ row }) => <DocumentStatusBadge status={row.original.status} revising={row.original.revising} />,
    }),
    helper.accessor("totalCents", {
      header: "Total",
      sortFn: "basic",
      meta: { align: "end", search: (doc: DocumentSummary) => formatCents(doc.totalCents) },
      cell: ({ getValue }) => formatCents(getValue()),
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      meta: { width: "fit" },
      cell: ({ row }) => <RowActions actions={documentActions(row.original)} />,
    }),
  ]);

/** A card's tick, as a card has no checkbox: a toggle among its buttons. */
export interface CardTick {
  selectable: boolean;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}

/** The toggle a card ticks with, when it can be ticked. */
export function tickAction(tick: CardTick | undefined): Array<Action> {
  if (!tick?.selectable) return [];
  return [{ type: "toggle", label: tick.selected ? "Ticked" : "Tick", pressed: tick.selected, onPressedChange: tick.onSelectedChange }];
}

interface DocumentCardProps {
  doc: DocumentSummary;
  clientsById: ReadonlyMap<string, ClientView>;
  search?: DocumentsSearch | undefined;
  tick?: CardTick | undefined;
}

/** The phone layout of a table row: the client under its number, as the table's Client column. */
export function DocumentCard({ doc, clientsById, search, tick }: DocumentCardProps) {
  return (
    <DataCard
      title={
        <>
          <DocumentTypeIcon type={doc.type} />
          <span className="font-medium">{documentName(doc)}</span>
          <DocumentStatusBadge status={doc.status} revising={doc.revising} />
        </>
      }
      value={formatCents(doc.totalCents)}
      meta={
        <>
          <DocumentClient doc={doc} clientsById={clientsById} />
          {addressedTo(doc, clientsById) && ` · ${addressedTo(doc, clientsById)?.toLowerCase()}`}
        </>
      }
      detail={`${coversText(doc.covers)} · ${dateText(doc)}`}
      actions={[...tickAction(tick), ...documentActions(doc)]}
      open={documentLink(doc, search)}
    />
  );
}

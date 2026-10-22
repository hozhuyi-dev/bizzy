import { LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { DOCUMENT_STATUS } from "./documents.constant";
import { documentLabel, documentRoute, shareUrl } from "./documents.util";
import type { LinkOptions } from "@tanstack/react-router";
import type { DocumentStatus, DocumentSummary, DocumentsSearch } from "./documents.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { Badge } from "~/components/ui/badge";
import { CellLink, CellText } from "~/components/shared/list/data-table/data-table-cell.component";
import { createDataTableColumnHelper } from "~/components/shared/list/data-table/data-table.config";
import { DataCard } from "~/components/shared/list/data-card/data-card.component";
import { RowActions } from "~/components/shared/actions/row-actions/row-actions.component";
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

function DocumentLink({ doc, search }: { doc: DocumentSummary; search: DocumentsSearch | undefined }) {
  return <CellLink {...documentLink(doc, search)}>{documentLabel(doc.number, doc.revision)}</CellLink>;
}

/** The document's page, with the list it steps through. */
export function documentLink(doc: Pick<DocumentSummary, "id" | "type">, search?: DocumentsSearch): LinkOptions {
  return { to: documentRoute(doc.type), params: { id: doc.id }, search: search ?? {} };
}

/** A draft takes the day it is issued. */
function dateText(doc: DocumentSummary): string {
  return doc.date ? formatDate(doc.date) : "Dated when issued";
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

const helper = createDataTableColumnHelper<DocumentSummary>();

/** The table's columns; `search` is the list's filter, for each document's page to step through. */
export const createDocumentColumns = (search: DocumentsSearch | undefined) =>
  helper.columns([
    helper.accessor((doc) => doc.number ?? "", {
      id: "number",
      header: "No.",
      sortFn: "alphanumeric",
      meta: { search: (doc: DocumentSummary) => documentLabel(doc.number, doc.revision) },
      cell: ({ row }) => <DocumentLink doc={row.original} search={search} />,
    }),
    helper.accessor((doc) => doc.date ?? "", {
      id: "date",
      header: "Date",
      sortFn: "basic",
      meta: { search: (doc: DocumentSummary) => (doc.date ? formatDate(doc.date) : undefined) },
      cell: ({ row }) =>
        row.original.date ? formatDate(row.original.date) : <span className="text-muted-foreground">{dateText(row.original)}</span>,
    }),
    helper.accessor("recipientName", {
      header: "For",
      sortFn: "alphanumeric",
      meta: { width: "grow" },
      cell: ({ getValue }) => <CellText title={getValue()}>{getValue()}</CellText>,
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

/** The phone layout of a table row. */
export function DocumentCard({ doc, search }: { doc: DocumentSummary; search?: DocumentsSearch | undefined }) {
  return (
    <DataCard
      title={
        <>
          <span className="font-medium">{documentLabel(doc.number, doc.revision)}</span>
          <DocumentStatusBadge status={doc.status} revising={doc.revising} />
        </>
      }
      value={formatCents(doc.totalCents)}
      meta={doc.recipientName}
      detail={dateText(doc)}
      actions={documentActions(doc)}
      open={documentLink(doc, search)}
    />
  );
}

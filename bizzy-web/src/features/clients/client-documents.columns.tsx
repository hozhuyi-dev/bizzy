import { FileTextIcon, ReceiptIcon } from "lucide-react";
import type { DocumentSummary } from "~/features/documents/documents.types";
import { DocumentStatusBadge, documentLink } from "~/features/documents/documents.columns";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { documentLabel } from "~/features/documents/documents.util";
import { CellText, RowLink } from "~/components/shared/data-table/data-table-cell.component";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.config";
import { DataCard } from "~/components/shared/data-card/data-card.component";
import { Checkbox } from "~/components/ui/checkbox";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";

const helper = createDataTableColumnHelper<DocumentSummary>();

/** "Invoice INV-2026-0012-00", or "Draft invoice": a client's document, of either type. */
export function clientDocumentLabel(doc: DocumentSummary): string {
  const title = DOCUMENT_TYPES[doc.type].title;
  return doc.number ? `${title} ${documentLabel(doc.number, doc.revision)}` : `Draft ${title.toLowerCase()}`;
}

/** A draft takes the day it is issued. */
function dateText(doc: DocumentSummary): string {
  return doc.date ? formatDate(doc.date) : "Dated when issued";
}

/**
 * A client's documents, of every type, ticked to send or put together.
 * Cancelled ones are listed, not ticked.
 */
export const createClientDocumentColumns = () =>
  helper.columns([
    helper.display({
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
          aria-label={`Tick ${clientDocumentLabel(row.original)}`}
          disabled={!row.getCanSelect()}
          checked={row.getIsSelected()}
          onCheckedChange={(checked) => row.toggleSelected(checked)}
        />
      ),
    }),
    helper.accessor((doc) => doc.number ?? "", {
      id: "number",
      header: "Document",
      sortFn: "alphanumeric",
      meta: { width: "grow", search: (doc: DocumentSummary) => [clientDocumentLabel(doc), dateText(doc)] },
      cell: ({ row }) => {
        const doc = row.original;
        const Icon = doc.type === "invoice" ? FileTextIcon : ReceiptIcon;
        return (
          <CellText sub={dateText(doc)}>
            <span className="flex min-w-0 items-center gap-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <RowLink {...documentLink(doc)}>{clientDocumentLabel(doc)}</RowLink>
            </span>
          </CellText>
        );
      },
    }),
    helper.accessor("status", {
      header: "Status",
      sortFn: "alphanumeric",
      cell: ({ row }) => <DocumentStatusBadge status={row.original.status} revising={row.original.revising} />,
    }),
    helper.accessor("totalCents", {
      header: "Total",
      sortFn: "basic",
      meta: { align: "end", search: (doc: DocumentSummary) => formatCents(doc.totalCents) },
      cell: ({ getValue }) => formatCents(getValue()),
    }),
  ]);

interface ClientDocumentCardProps {
  doc: DocumentSummary;
  selectable: boolean;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}

/** The phone layout of a row: ticked with a toggle, as a card has no checkbox. */
export function ClientDocumentCard({ doc, selectable, selected, onSelectedChange }: ClientDocumentCardProps) {
  return (
    <DataCard
      title={
        <>
          <span className="font-medium">{clientDocumentLabel(doc)}</span>
          <DocumentStatusBadge status={doc.status} revising={doc.revising} />
        </>
      }
      value={formatCents(doc.totalCents)}
      meta={dateText(doc)}
      actions={
        selectable
          ? [{ type: "toggle", label: selected ? "Ticked" : "Tick", pressed: selected, onPressedChange: onSelectedChange }]
          : []
      }
      open={documentLink(doc)}
    />
  );
}

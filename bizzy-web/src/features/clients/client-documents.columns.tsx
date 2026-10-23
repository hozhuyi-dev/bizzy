import { FileTextIcon, ReceiptIcon } from "lucide-react";
import type { DocumentSummary } from "~/features/documents/documents.types";
import { DocumentStatusBadge, documentLink } from "~/features/documents/documents.columns";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { coversText, documentLabel } from "~/features/documents/documents.util";
import { CellLink, CellText } from "~/components/shared/list/data-table/data-table-cell.component";
import { createDataTableColumnHelper } from "~/components/shared/list/data-table/data-table.config";
import { DataCard } from "~/components/shared/list/data-card/data-card.component";
import { Checkbox } from "~/components/ui/checkbox";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";

const helper = createDataTableColumnHelper<DocumentSummary>();

/** "Invoice INV-2026-0012-00", or "Draft invoice": a client's document, of either type. */
export function clientDocumentLabel(doc: DocumentSummary): string {
  const title = DOCUMENT_TYPES[doc.type].title;
  return doc.number ? `${title} ${documentLabel(doc.number, doc.revision)}` : `Draft ${title.toLowerCase()}`;
}

/** What its lines are for, then its date: "3 sessions, 5–19 Oct · dated 21 Oct 2026". A draft takes the day it is issued. */
function aboutText(doc: DocumentSummary): string {
  const covers = coversText(doc.covers);
  return doc.date ? `${covers} · dated ${formatDate(doc.date)}` : covers;
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
      meta: { width: "grow", search: (doc: DocumentSummary) => [clientDocumentLabel(doc), aboutText(doc)] },
      cell: ({ row }) => {
        const doc = row.original;
        const Icon = doc.type === "invoice" ? FileTextIcon : ReceiptIcon;
        return (
          <CellText sub={aboutText(doc)}>
            <span className="flex min-w-0 items-center gap-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <CellLink {...documentLink(doc)}>{clientDocumentLabel(doc)}</CellLink>
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
      meta={aboutText(doc)}
      actions={
        selectable
          ? [{ type: "toggle", label: selected ? "Ticked" : "Tick", pressed: selected, onPressedChange: onSelectedChange }]
          : []
      }
      open={documentLink(doc)}
    />
  );
}

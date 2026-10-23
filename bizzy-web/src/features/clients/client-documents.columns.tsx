import type { DocumentSummary } from "~/features/documents/documents.types";
import type { CardTick } from "~/features/documents/documents.columns";
import {
  DocumentStatusBadge,
  DocumentTypeIcon,
  documentDateColumn,
  documentLink,
  documentName,
  documentTickColumn,
  tickAction,
} from "~/features/documents/documents.columns";
import { coversText } from "~/features/documents/documents.util";
import { CellText } from "~/components/shared/list/data-table/data-table-cell.component";
import { createDataTableColumnHelper } from "~/components/shared/list/data-table/data-table.config";
import { DataCard } from "~/components/shared/list/data-card/data-card.component";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";

const helper = createDataTableColumnHelper<DocumentSummary>();

/** A card's line: what its lines are for, then its date: "3 sessions, 5–19 Oct · dated 21 Oct 2026". A draft takes the day it is issued. */
function aboutText(doc: DocumentSummary): string {
  const covers = coversText(doc.covers);
  return doc.date ? `${covers} · dated ${formatDate(doc.date)}` : covers;
}

/**
 * A client's documents, of every type, ticked to send or put together, in
 * the documents list's order (by date). Cancelled ones are listed, not
 * ticked.
 */
export const createClientDocumentColumns = () =>
  helper.columns([
    documentTickColumn,
    documentDateColumn,
    helper.accessor((doc) => doc.number ?? "", {
      id: "number",
      header: "Document",
      meta: { width: "grow", search: (doc: DocumentSummary) => [documentName(doc), coversText(doc.covers)] },
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <CellText sub={coversText(doc.covers)}>
            <span className="flex min-w-0 items-center gap-2">
              <DocumentTypeIcon type={doc.type} />
              <span className="truncate font-medium">{documentName(doc)}</span>
            </span>
          </CellText>
        );
      },
    }),
    helper.accessor("status", {
      header: "Status",
      cell: ({ row }) => <DocumentStatusBadge status={row.original.status} revising={row.original.revising} />,
    }),
    helper.accessor("totalCents", {
      header: "Total",
      meta: { align: "end", search: (doc: DocumentSummary) => formatCents(doc.totalCents) },
      cell: ({ getValue }) => formatCents(getValue()),
    }),
  ]);

/** The phone layout of a row: ticked with a toggle, as a card has no checkbox. */
export function ClientDocumentCard({ doc, tick }: { doc: DocumentSummary; tick: CardTick }) {
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
      meta={aboutText(doc)}
      actions={tickAction(tick)}
      open={documentLink(doc)}
    />
  );
}

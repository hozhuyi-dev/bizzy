import type { DocumentSearch, DocumentSummary } from "~/features/documents/documents.types";
import type { ClientView } from "./clients.types";
import type { Tick } from "~/components/shared/list/tick-slot/tick-slot.component";
import {
  DocumentStatusBadge,
  DocumentTypeIcon,
  documentDateColumn,
  documentLink,
  documentName,
  documentSlotColumn,
} from "~/features/documents/documents.columns";
import { coversText } from "~/features/documents/documents.util";
import { CellText } from "~/components/shared/list/data-table/data-table-cell.component";
import { createDataTableColumnHelper } from "~/components/shared/list/data-table/data-table.config";
import { DataCard } from "~/components/shared/list/data-card/data-card.component";
import { TickSlot } from "~/components/shared/list/tick-slot/tick-slot.component";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";

const helper = createDataTableColumnHelper<DocumentSummary>();

/** The client whose page lists the documents, and every client by id, to say who else pays or is paid for. */
export interface Whose {
  clientId: string;
  clientsById: ReadonlyMap<string, ClientView>;
}

/**
 * Who else a client's document is about: "billed to Mum" when someone else
 * pays it, "for Adam, Lina" when what the client pays is someone else's;
 * "" when it is theirs alone.
 */
export function whoseText(doc: DocumentSummary, { clientId, clientsById }: Whose): string {
  const name = (id: string) => clientsById.get(id)?.name.split(" ")[0] ?? "someone else";
  if (doc.clientId !== clientId) return `billed to ${name(doc.clientId)}`;
  return doc.for.length > 0 ? `for ${doc.for.map(name).join(", ")}` : "";
}

/** What its lines are for, and who else it is about: "3 sessions, 5–19 Oct · billed to Mum". */
function coversWhose(doc: DocumentSummary, whose: Whose): string {
  return [coversText(doc.covers), whoseText(doc, whose)].filter(Boolean).join(" · ");
}

/** A card's line: what its lines are for, then its date: "3 sessions, 5–19 Oct · dated 21 Oct 2026". A draft takes the day it is issued. */
function aboutText(doc: DocumentSummary, whose: Whose): string {
  const covers = coversWhose(doc, whose);
  return doc.date ? `${covers} · dated ${formatDate(doc.date)}` : covers;
}

/**
 * A client's documents, of every type, ticked to send or put together, in
 * the documents list's order (by date). Cancelled ones are listed, not
 * ticked. Those someone else pays, or that are for someone else too, say so.
 */
export const createClientDocumentColumns = (whose: Whose) =>
  helper.columns([
    documentSlotColumn,
    documentDateColumn,
    helper.accessor((doc) => doc.number ?? "", {
      id: "number",
      header: "Document",
      meta: { width: "grow", search: (doc: DocumentSummary) => [documentName(doc), coversWhose(doc, whose)] },
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <CellText sub={coversWhose(doc, whose)}>
            <span className="truncate font-medium">{documentName(doc)}</span>
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

/** The phone layout of a row: ticked by its slot, as the documents list's; `search`, the list its page steps through. */
export function ClientDocumentCard({ doc, tick, search, whose }: { doc: DocumentSummary; tick: Tick; search: DocumentSearch; whose: Whose }) {
  return (
    <DataCard
      leading={<TickSlot icon={<DocumentTypeIcon type={doc.type} />} tick={tick} />}
      selected={tick.ticked}
      title={
        <>
          <span className="font-medium">{documentName(doc)}</span>
          <DocumentStatusBadge status={doc.status} revising={doc.revising} />
        </>
      }
      value={formatCents(doc.totalCents)}
      meta={aboutText(doc, whose)}
      open={documentLink(doc, search)}
    />
  );
}

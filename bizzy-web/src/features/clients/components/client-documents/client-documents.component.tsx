import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { ClientDocumentCard, createClientDocumentColumns } from "../../client-documents.columns";
import { ClientsQuery } from "../../clients.query";
import type { RowSelectionState } from "@tanstack/react-table";
import type { ClientView } from "../../clients.types";
import type { DocumentSummary } from "~/features/documents/documents.types";
import type { PageSection } from "~/components/shared/layout/page-sections/page-sections.component";
import type { ListFilter } from "~/core/list/filter.types";
import { DocumentsQuery } from "~/features/documents/documents.query";
import { documentLink, documentTick } from "~/features/documents/documents.columns";
import {
  DOCUMENT_STATUS_FACET,
  DOCUMENT_TYPE_FACET,
  clientDocumentsSearch,
  documentsOfClient,
} from "~/features/documents/documents.util";
import { canTick } from "~/features/documents/documents.hook";
import { TickedBar } from "~/features/documents/components/ticked-bar/ticked-bar.component";
import { recipientOf } from "~/features/whatsapp/whatsapp.util";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { SelectionHint } from "~/components/shared/list/selection-bar/selection-bar.component";
import { dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { NO_FILTER } from "~/core/list/filter.util";
import { QUIPS } from "~/core/constants/quips.constant";

const FACETS = [DOCUMENT_TYPE_FACET, DOCUMENT_STATUS_FACET];

/**
 * The client's documents section: every invoice and receipt, by date as
 * the documents list (a draft by its latest session), narrowed by type and status. The user ticks invoices to ask
 * to pay for in one WhatsApp message (what drafts list, issued ones as a
 * whole with their links), issued ones to send for the client's records,
 * or drafts of one type to put on one document, by each one's slot: the
 * same as the documents list, with the same selection bar. A new client
 * has none.
 */
export function useClientDocumentsSection(client: ClientView | undefined): PageSection | undefined {
  const docs = DocumentsQuery.useByClient(client?.id ?? "");
  const clientsById = ClientsQuery.useById();
  const whose = useMemo(() => ({ clientId: client?.id ?? "", clientsById }), [client?.id, clientsById]);
  const columns = useMemo(() => createClientDocumentColumns(whose), [whose]);
  const [filter, setFilter] = useState<ListFilter>(NO_FILTER);
  const [selection, setSelection] = useState<RowSelectionState>({});

  const all = useMemo(() => docs.data ?? [], [docs.data]);
  const data = useMemo(() => documentsOfClient(all, filter.chips), [all, filter.chips]);
  // Who pays the ticked: the first tick's payer, as each message is one chat.
  const payerId = data.find((doc) => selection[doc.id])?.clientId;
  const tickable = (doc: DocumentSummary) => canTick(doc) && (payerId === undefined || doc.clientId === payerId);
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId: (doc) => doc.id,
    // In the documents list's order, the API's: by date, latest first.
    enableSorting: false,
    enableRowSelection: (row) => tickable(row.original),
    state: { rowSelection: selection },
    onRowSelectionChange: setSelection,
  });
  const chosen = data.filter((doc) => selection[doc.id]);
  const ticking = chosen.length > 0;
  // Each document's page steps through these, narrowed as here: the documents list's order too.
  const search = useMemo(() => client && clientDocumentsSearch(client.id, filter.chips), [client, filter.chips]);

  if (!client || !search) return undefined;
  return {
    id: "documents",
    title: "Documents",
    bare: true,
    content: (
      <div className="flex flex-col gap-3">
        {all.length > 0 && (
          <FilterBar
            label={`Search ${client.name}'s documents`}
            value={filter}
            onChange={(next) => {
              // What is ticked out of sight would be sent unseen.
              if (JSON.stringify(next.chips) !== JSON.stringify(filter.chips)) setSelection({});
              setFilter(next);
            }}
            facets={FACETS}
          />
        )}
        <DataTable
          table={table}
          source={docs}
          query={filter.text}
          rowLink={(doc) => documentLink(doc, search)}
          empty={<EmptyState quips={QUIPS.timeline}>No invoices or receipts yet. They're drafted with each session.</EmptyState>}
          renderCard={(row) => (
            <ClientDocumentCard
              doc={row.original}
              search={search}
              whose={whose}
              tick={documentTick(
                row.original,
                { tickable: row.getCanSelect(), ticked: row.getIsSelected(), onTickedChange: (on) => row.toggleSelected(on) },
                ticking,
              )}
            />
          )}
        />
        {!ticking && data.some(canTick) && <SelectionHint>Tick documents for more actions</SelectionHint>}
        {ticking && (
          <TickedBar
            chosen={chosen}
            to={recipientOf(clientsById.get(payerId ?? client.id) ?? client)}
            all={data.filter(tickable)}
            onTick={(picked) => setSelection(Object.fromEntries(picked.map((doc) => [doc.id, true])))}
          />
        )}
      </div>
    ),
  };
}

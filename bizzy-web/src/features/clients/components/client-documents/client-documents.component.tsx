import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { ClientDocumentCard, createClientDocumentColumns } from "../../client-documents.columns";
import type { RowSelectionState } from "@tanstack/react-table";
import type { ClientView } from "../../clients.types";
import type { PageSection } from "~/components/shared/layout/page-sections/page-sections.component";
import type { ListFilter } from "~/core/list/filter.types";
import { DocumentsQuery } from "~/features/documents/documents.query";
import { documentLink } from "~/features/documents/documents.columns";
import { DOCUMENT_STATUS_FACET, DOCUMENT_TYPE_FACET } from "~/features/documents/documents.util";
import { canTick, useDocumentBulkActions } from "~/features/documents/documents.hook";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { NO_FILTER } from "~/core/list/filter.util";
import { QUIPS } from "~/core/constants/quips.constant";

const COLUMNS = createClientDocumentColumns();
const FACETS = [DOCUMENT_TYPE_FACET, DOCUMENT_STATUS_FACET];

/**
 * The client's documents section: every invoice and receipt, by date as
 * the documents list (a draft by its latest session), narrowed by type and status. The user ticks invoices to ask
 * to pay for in one WhatsApp message (what drafts list, issued ones as a
 * whole with their links), issued ones to send for the client's records,
 * or drafts of one type to put on one document: the same as the documents
 * list does for one client. A new client has none.
 */
export function useClientDocumentsSection(client: ClientView | undefined): PageSection | undefined {
  const docs = DocumentsQuery.useByClient(client?.id ?? "");
  const [filter, setFilter] = useState<ListFilter>(NO_FILTER);
  const [selection, setSelection] = useState<RowSelectionState>({});

  const all = useMemo(() => docs.data ?? [], [docs.data]);
  const data = useMemo(() => {
    const { type = [], status = [] } = filter.chips;
    return all.filter((doc) => (type.length === 0 || type.includes(doc.type)) && (status.length === 0 || status.includes(doc.status)));
  }, [all, filter.chips]);
  const table = useTable({
    features: dataTableFeatures,
    columns: COLUMNS,
    data,
    getRowId: (doc) => doc.id,
    // In the documents list's order, the API's: by date, latest first.
    enableSorting: false,
    enableRowSelection: (row) => canTick(row.original),
    state: { rowSelection: selection },
    onRowSelectionChange: setSelection,
  });
  const chosen = data.filter((doc) => selection[doc.id]);
  const actions = useDocumentBulkActions(chosen, { name: client?.name ?? "", phone: client?.contact?.phone }, () => setSelection({}));

  if (!client) return undefined;
  return {
    id: "documents",
    title: "Documents",
    // What each action is for is said on it while it can't be taken.
    description: all.length > 0 ? (chosen.length > 0 ? `${chosen.length} ticked.` : "None ticked.") : undefined,
    more: all.length > 0 ? actions : undefined,
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
          rowLink={(doc) => documentLink(doc)}
          empty={<EmptyState quips={QUIPS.timeline}>No invoices or receipts yet. They're drafted with each session.</EmptyState>}
          renderCard={(row) => (
            <ClientDocumentCard
              doc={row.original}
              tick={{
                selectable: row.getCanSelect(),
                selected: row.getIsSelected(),
                onSelectedChange: (on) => row.toggleSelected(on),
              }}
            />
          )}
        />
      </div>
    ),
  };
}

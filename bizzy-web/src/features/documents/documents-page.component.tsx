import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { cn } from "cn";
import { DocumentCard, createDocumentColumns, documentLink, documentTick } from "./documents.columns";
import { DocumentsQuery } from "./documents.query";
import { canTick } from "./documents.hook";
import { documentFacets, documentPresets, documentsUrl } from "./documents.util";
import { TickedBar } from "./components/ticked-bar/ticked-bar.component";
import type { RowSelectionState } from "@tanstack/react-table";
import type { DocumentSummary } from "./documents.types";
import type { ListFilter } from "~/core/list/filter.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { LoadMore } from "~/components/shared/list/load-more/load-more.component";
import { SelectionHint } from "~/components/shared/list/selection-bar/selection-bar.component";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { formatWhen, isNarrowed, pageItems, presetLabel } from "~/core/list/filter.util";
import { allOf } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

interface DocumentsPageProps {
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * Invoices and receipts by date, latest first (a draft by its latest
 * session), searched on the server a page at a time: by number, who it is
 * for, type, client, status, what is owed and days. Each can be ticked by
 * its slot to ask to pay, send or put together, as on the client's page.
 * Each of those is for one client, so the first tick fixes the client: only
 * theirs can be ticked after it, and the selection bar says whose they are.
 * Changing the filter clears the ticks, so nothing out of sight is sent.
 * Documents are made from a session or a package, so there is no "new"
 * button here.
 */
export function DocumentsPage({ filter, onFilterChange }: DocumentsPageProps) {
  const clients = ClientsQuery.useList();
  const clientsById = ClientsQuery.useById();
  const facets = useMemo(() => documentFacets(clients.data ?? []), [clients.data]);
  const presets = useMemo(() => documentPresets(), []);
  const documents = DocumentsQuery.useSearch(filter);
  const data = useMemo(() => pageItems(documents.data), [documents.data]);
  // Each document's page steps through this list.
  const search = useMemo(() => documentsUrl.toSearch(filter), [filter]);
  const columns = useMemo(() => createDocumentColumns(search, clientsById), [search, clientsById]);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const ticked = (doc: DocumentSummary) => selection[doc.id] === true;
  // Whose the ticked are: the first tick's client.
  const clientId = data.find(ticked)?.clientId;
  const tickable = (doc: DocumentSummary) => canTick(doc) && (clientId === undefined || doc.clientId === clientId);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId: (doc) => doc.id,
    // Read a page at a time, by date: sorting a page would only sort what
    // is loaded.
    enableSorting: false,
    enableRowSelection: (row) => tickable(row.original),
    state: { rowSelection: selection },
    onRowSelectionChange: setSelection,
  });
  const chosen = data.filter(ticked);
  const ticking = chosen.length > 0;
  const client = clientId === undefined ? undefined : clientsById.get(clientId);
  const toolbar = (
    <FilterBar
      label="Search documents"
      value={filter}
      onChange={(next) => {
        // What is ticked out of sight would be sent unseen.
        setSelection({});
        onFilterChange(next);
      }}
      facets={facets}
      presets={presets}
      dates
    />
  );

  return (
    <>
      <PageHeader title="Documents" subtitle={presetLabel(filter, presets)} toolbar={toolbar} />
      <div className={cn("transition-opacity", documents.isPlaceholderData && "opacity-60")}>
        <DataTable
          table={table}
          source={allOf(documents, clients)}
          rowLink={(doc) => documentLink(doc, search)}
          empty={
            isNarrowed(filter) || documents.hasNextPage ? (
              <EmptyState quips={QUIPS.search}>No documents found{documents.hasNextPage ? " yet" : ""}.</EmptyState>
            ) : (
              // Keyed by the days: each empty stretch gets its own line.
              <EmptyState key={filter.when} quips={QUIPS.invoices}>
                No invoices or receipts{filter.when ? ` in ${formatWhen(filter.when)}` : " yet"}. They're drafted
                with each session and package.
              </EmptyState>
            )
          }
          renderCard={(row) => (
            <DocumentCard
              doc={row.original}
              clientsById={clientsById}
              search={search}
              tick={documentTick(
                row.original,
                { tickable: row.getCanSelect(), ticked: row.getIsSelected(), onTickedChange: (on) => row.toggleSelected(on) },
                ticking,
              )}
            />
          )}
        />
        <LoadMore pages={documents} found={data.length > 0} />
      </div>
      {!ticking && data.some(canTick) && <SelectionHint>Tick documents for more actions</SelectionHint>}
      {ticking && (
        <TickedBar
          chosen={chosen}
          to={{ name: client?.name ?? chosen[0]?.recipientName ?? "", phone: client?.contact?.phone }}
          all={data.filter(tickable)}
          onTick={(picked) => setSelection(Object.fromEntries(picked.map((doc) => [doc.id, true])))}
        />
      )}
    </>
  );
}

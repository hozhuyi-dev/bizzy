import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { cn } from "cn";
import { DocumentCard, createDocumentColumns, documentLink } from "./documents.columns";
import { DocumentsQuery } from "./documents.query";
import { canTick, documentBulkActionsUntil, useDocumentBulkActions } from "./documents.hook";
import { documentFacets, documentPresets, documentsUrl, singleClientOf } from "./documents.util";
import type { ReactNode } from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import type { DocumentSummary } from "./documents.types";
import type { ClientView } from "~/features/clients/clients.types";
import type { ListFilter } from "~/core/list/filter.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { LoadMore } from "~/components/shared/list/load-more/load-more.component";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { formatWhen, isNarrowed, pageItems } from "~/core/list/filter.util";
import { allOf } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

const UNTIL_ONE_CLIENT = documentBulkActionsUntil("Pick one client in the filter to tick their documents.");

interface DocumentsPageProps {
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * Invoices and receipts by date, latest first (a draft by its latest
 * session), searched on the server a page at a time: by number, who it is
 * for, type, client, status, what is owed and days. Narrowed to one
 * client, they can be ticked to ask to pay, send or put together, as on
 * the client's page: each of those is for one client, so until then the
 * actions say so.
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
  const clientId = singleClientOf(filter);
  const client = clients.data?.find((c) => c.id === clientId);
  const ticking = client !== undefined;
  const columns = useMemo(() => createDocumentColumns(search, clientsById, ticking), [search, clientsById, ticking]);
  const [selection, setSelection] = useState<RowSelectionState>({});

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId: (doc) => doc.id,
    // Read a page at a time, by date: sorting a page would only sort what
    // is loaded.
    enableSorting: false,
    enableRowSelection: (row) => ticking && canTick(row.original),
    state: { rowSelection: selection },
    onRowSelectionChange: setSelection,
  });
  const chosen = ticking ? data.filter((doc) => selection[doc.id]) : [];
  const toolbar = (
    <FilterBar
      label="Search documents"
      value={filter}
      onChange={(next) => {
        // Ticks are one client's, and what is ticked out of sight would be sent unseen.
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
      {ticking ? (
        <TickingHeader client={client} chosen={chosen} toolbar={toolbar} onDone={() => setSelection({})} />
      ) : (
        <PageHeader title="Documents" moreActions={UNTIL_ONE_CLIENT} toolbar={toolbar} />
      )}
      {/* Kept while ticking, so the first tick doesn't move the list; what each action is for is said on it. */}
      {ticking && (
        <p className="text-sm text-muted-foreground">
          {chosen.length > 0 ? `${chosen.length} of ${client.name}'s ticked.` : `None of ${client.name}'s ticked.`}
        </p>
      )}
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
              tick={
                ticking
                  ? {
                      selectable: row.getCanSelect(),
                      selected: row.getIsSelected(),
                      onSelectedChange: (on) => row.toggleSelected(on),
                    }
                  : undefined
              }
            />
          )}
        />
        <LoadMore pages={documents} found={data.length > 0} />
      </div>
    </>
  );
}

interface TickingHeaderProps {
  client: ClientView;
  chosen: ReadonlyArray<DocumentSummary>;
  toolbar: ReactNode;
  onDone: () => void;
}

/**
 * The header while the list is one client's, with what can be done to the
 * ticked: its own component, so what the actions read (the settings the
 * WhatsApp messages are written from) is read only once there are any.
 */
function TickingHeader({ client, chosen, toolbar, onDone }: TickingHeaderProps) {
  const actions = useDocumentBulkActions(chosen, { name: client.name, phone: client.contact?.phone }, onDone);
  return <PageHeader title="Documents" moreActions={actions} toolbar={toolbar} />;
}

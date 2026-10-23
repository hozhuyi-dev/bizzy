import { useCallback, useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { ClientCard, clientLink, clientSorting, createClientColumns } from "./clients.columns";
import { useClientRows } from "./clients.hook";
import { ClientsQuery } from "./clients.query";
import { clientsListSearch, facetsOf } from "./clients.util";
import type { ClientRow, ClientView, ClientsFilter, ClientsListSearch } from "./clients.types";
import type { ListFilter } from "~/core/list/filter.types";
import type { Loadable } from "~/core/utils/query.util";
import type { FollowUpTarget } from "~/features/follow-ups/follow-ups.types";
import { ActivityQuery } from "~/features/activity/activity.query";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { sortingFromFilter } from "~/components/shared/list/data-table/data-table-sort.util";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { FollowUpsMutation } from "~/features/follow-ups/follow-ups.mutation";
import { useWhatsApp } from "~/features/whatsapp/whatsapp.hook";
import { allOf } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

interface ClientsPageProps {
  /** All clients, or Reconnect: those worth getting back in touch with. */
  view: ClientsFilter;
  /** Words, and the view's chips: where each client stands, or how long Reconnect's have lapsed. */
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * Every client and where each stands, or Reconnect: those with no session
 * in a while, nothing booked and nothing waiting, most valuable first.
 * Every client is loaded already, so the search filters here.
 */
export function ClientsPage({ view, filter, onFilterChange }: ClientsPageProps) {
  const clients = ClientsQuery.useList();
  // Where each stands comes with their activity.
  const activity = ActivityQuery.useList();
  const rows = useClientRows(filter);
  // Each client's page steps through this list.
  const search = useMemo(() => clientsListSearch(filter), [filter]);

  return (
    <>
      <PageHeader
        title={view === "reconnect" ? "Reconnect" : "All clients"}
        actions={[{ type: "link", label: "New client", icon: PlusIcon, style: "primary", link: { to: "/clients/new" } }]}
        toolbar={<FilterBar label="Search clients" value={filter} onChange={onFilterChange} facets={facetsOf(view)} />}
      />

      {/* Keyed by view: each view has its own columns and sort order. */}
      <ClientsTable
        key={view}
        view={view}
        rows={rows}
        source={allOf(clients, activity)}
        filter={filter}
        onFilterChange={onFilterChange}
        search={search}
      />
    </>
  );
}

interface ClientsTableProps {
  view: ClientsFilter;
  rows: Array<ClientRow>;
  source: Loadable;
  /** Its words are searched in the table; its sort orders it. */
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
  search: ClientsListSearch;
}

function ClientsTable({ view, rows, source, filter, onFilterChange, search }: ClientsTableProps) {
  const { mutate: reachedOut } = FollowUpsMutation.useReachedOut();
  const { mutate: undo } = FollowUpsMutation.useDelete();
  const reconnect = view === "reconnect";
  const [remind, setRemind] = useState<FollowUpTarget | null>(null);
  const onRemind = useCallback((client: ClientView) => setRemind({ mode: "new", clientId: client.id }), []);

  // A follow-up done today is the record of it; deleting it undoes a mis-tap.
  const onContacted = useCallback(
    (client: ClientView) =>
      reachedOut(client.id, {
        onSuccess: (followUp) =>
          toastWithQuip(`Marked ${client.name} as contacted`, QUIPS.todoDone, {
            action: { label: "Undo", onClick: () => undo(followUp.id) },
          }),
        onError: toastRefusal,
      }),
    [reachedOut, undo],
  );

  const whatsapp = useWhatsApp();
  const onWhatsApp = useCallback((client: ClientView) => whatsapp.message(client.contact?.phone), [whatsapp]);
  const handlers = useMemo(
    () => (reconnect ? { onWhatsApp, onContacted, onRemind } : { onWhatsApp }),
    [onWhatsApp, onContacted, onRemind, reconnect],
  );
  const columns = useMemo(() => createClientColumns(view, handlers, search), [view, handlers, search]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId: (row) => row.client.id,
    // Kept in the URL, so a client's page steps through it in this order.
    ...sortingFromFilter(filter, onFilterChange, clientSorting(view), columns),
  });

  return (
    <>
      <DataTable
        table={table}
        source={source}
        query={filter.text}
        rowLink={(row) => clientLink(row.client.id, search)}
        empty={
          reconnect ? (
            <EmptyState quips={QUIPS.clientsReconnect}>Nobody to get back in touch with right now.</EmptyState>
          ) : (
            <EmptyState quips={QUIPS.clients}>No clients yet. Add one, or link an unmatched calendar entry.</EmptyState>
          )
        }
        renderCard={(row) => <ClientCard view={view} row={row.original} search={search} {...handlers} />}
      />
      <FollowUpDialog target={remind} onClose={() => setRemind(null)} />
    </>
  );
}

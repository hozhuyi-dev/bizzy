import { useCallback, useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { CLIENT_SORTING, ClientCard, clientLink, createClientColumns } from "./clients.columns";
import { useClientRows } from "./clients.hook";
import { ClientsQuery } from "./clients.query";
import { CLIENT_FACETS, CLIENT_PRESETS, clientsUrl } from "./clients.util";
import type { ClientRow, ClientView, ClientsListSearch } from "./clients.types";
import type { ListFilter } from "~/core/list/filter.types";
import type { Loadable } from "~/core/utils/query.util";
import { ActivityQuery } from "~/features/activity/activity.query";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { sortingFromFilter } from "~/components/shared/list/data-table/data-table-sort.util";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { useOpenFollowUp } from "~/features/follow-ups/follow-ups.hook";
import { FollowUpsMutation } from "~/features/follow-ups/follow-ups.mutation";
import { useWhatsApp } from "~/features/whatsapp/whatsapp.hook";
import { allOf } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

interface ClientsPageProps {
  /** Words, and chips: where each client stands, how long since they were seen, what is missing. */
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * Every client and where each stands, narrowed by chips and presets; one
 * of them, Reconnect, is those with no session in a while, nothing booked
 * and nothing waiting, most valuable first. Every client is loaded
 * already, so the search filters here.
 */
export function ClientsPage({ filter, onFilterChange }: ClientsPageProps) {
  const clients = ClientsQuery.useList();
  // Where each stands comes with their activity.
  const activity = ActivityQuery.useList();
  const rows = useClientRows(filter);
  // Each client's page steps through this list.
  const search = useMemo(() => clientsUrl.toSearch(filter), [filter]);

  return (
    <>
      <PageHeader
        title="Clients"
        actions={[{ type: "link", label: "New client", icon: PlusIcon, style: "primary", link: { to: "/clients/new" } }]}
        toolbar={
          <FilterBar
            label="Search clients"
            value={filter}
            onChange={onFilterChange}
            facets={CLIENT_FACETS}
            presets={CLIENT_PRESETS}
          />
        }
      />

      <ClientsTable
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
  rows: Array<ClientRow>;
  source: Loadable;
  /** Its words are searched in the table; its sort orders it. */
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
  search: ClientsListSearch;
}

function ClientsTable({ rows, source, filter, onFilterChange, search }: ClientsTableProps) {
  const { mutate: reachedOut } = FollowUpsMutation.useReachedOut();
  const { mutate: undo } = FollowUpsMutation.useDelete();
  const openFollowUp = useOpenFollowUp();
  const onRemind = useCallback((client: ClientView) => openFollowUp({ mode: "new", clientId: client.id }), [openFollowUp]);

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
  const handlers = useMemo(() => ({ onWhatsApp, onContacted, onRemind }), [onWhatsApp, onContacted, onRemind]);
  const columns = useMemo(() => createClientColumns(handlers, search), [handlers, search]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId: (row) => row.client.id,
    // Kept in the URL, so a client's page steps through it in this order.
    ...sortingFromFilter(filter, onFilterChange, CLIENT_SORTING, columns),
  });

  return (
    <>
      <DataTable
        table={table}
        source={source}
        query={filter.text}
        rowLink={(row) => clientLink(row.client.id, search)}
        empty={
          filter.chips.lapse?.length ? (
            <EmptyState quips={QUIPS.clientsReconnect}>Nobody to get back in touch with right now.</EmptyState>
          ) : (
            <EmptyState quips={QUIPS.clients}>No clients yet. Add one, or link an unmatched calendar entry.</EmptyState>
          )
        }
        renderCard={(row) => <ClientCard row={row.original} search={search} {...handlers} />}
      />
    </>
  );
}

import { useCallback, useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { ClientCard, clientLink, clientSorting, createClientColumns } from "./clients.columns";
import { useClientRows } from "./clients.hook";
import { ClientsMutation } from "./clients.mutation";
import { ClientsQuery } from "./clients.query";
import { CLIENT_FACETS, clientsListSearch, lapseOf } from "./clients.util";
import type { ClientRow, ClientView, ClientsFilter, ClientsListSearch } from "./clients.types";
import type { ListFilter } from "~/core/list/filter.types";
import type { FollowUpTarget } from "~/features/follow-ups/follow-ups.types";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.config";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { FilterBar } from "~/components/shared/filter-bar/filter-bar.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { ActivityQuery } from "~/features/activity/activity.query";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { useWhatsApp } from "~/features/whatsapp/whatsapp.hook";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { toastWithQuip } from "~/components/shared/quip/quip-toast";

interface ClientsPageProps {
  /** Words, and the Last session chip that makes the list Reconnect. */
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * Every client, or (with a Last session chip) Reconnect: those with no
 * session in that long, worth getting back in touch with, most valuable
 * first. Every client is loaded already, so the search filters here.
 */
export function ClientsPage({ filter, onFilterChange }: ClientsPageProps) {
  const clients = ClientsQuery.useList();
  const rows = useClientRows(filter);
  const lapse = lapseOf(filter);
  const view: ClientsFilter = lapse ? "reconnect" : "all";
  // Each client's page steps through this list.
  const search = useMemo(() => clientsListSearch(filter), [filter]);

  return (
    <>
      <PageHeader
        title={lapse ? "Reconnect" : "All clients"}
        actions={[{ type: "link", label: "New client", icon: PlusIcon, style: "primary", link: { to: "/clients/new" } }]}
        toolbar={<FilterBar label="Search clients" value={filter} onChange={onFilterChange} facets={CLIENT_FACETS} />}
      />

      {queryMatch(clients, {
        pending: () => <Loading />,
        error: (error) => (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ),
        // Keyed by view: each view starts from its own sort order.
        success: () => <ClientsTable key={view} view={view} rows={rows} query={filter.text} search={search} />,
      })}
    </>
  );
}

interface ClientsTableProps {
  view: ClientsFilter;
  rows: Array<ClientRow>;
  /** The words searched in the table. */
  query: string;
  search: ClientsListSearch;
}

function ClientsTable({ view, rows, query, search }: ClientsTableProps) {
  const { mutate: mark } = ClientsMutation.useMarkContacted();
  const reconnect = view === "reconnect";
  const [remind, setRemind] = useState<FollowUpTarget | null>(null);
  const onRemind = useCallback((client: ClientView) => setRemind({ mode: "new", clientId: client.id }), []);

  const onContacted = useCallback(
    (client: ClientView) =>
      mark(
        { id: client.id, contacted: true },
        {
          onSuccess: () =>
            toastWithQuip(`Marked ${client.name} as contacted`, QUIPS.todoDone, {
              action: {
                label: "Undo",
                onClick: () => mark({ id: client.id, contacted: false }),
              },
            }),
          onError: (error) => toast.error(error.message),
        },
      ),
    [mark],
  );

  const whatsapp = useWhatsApp();
  const onWhatsApp = useCallback((client: ClientView) => whatsapp.message(client.contact?.phone), [whatsapp]);
  const handlers = useMemo(
    () => (reconnect ? { onWhatsApp, onContacted, onRemind } : { onWhatsApp }),
    [onWhatsApp, onContacted, onRemind, reconnect],
  );
  const columns = useMemo(() => createClientColumns(handlers, search), [handlers, search]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId: (row) => row.client.id,
    initialState: { sorting: clientSorting(view) },
  });

  return (
    <>
      <DataTable
        table={table}
        query={query}
        rowLink={(row) => clientLink(row.client.id, search)}
        empty={
          reconnect ? (
            <EmptyState quips={QUIPS.clientsReconnect}>Nobody to get back in touch with right now.</EmptyState>
          ) : (
            <EmptyState quips={QUIPS.clients}>No clients yet. Add one, or link an unmatched calendar entry.</EmptyState>
          )
        }
        renderCard={(row) => <ClientCard row={row.original} search={search} {...handlers} />}
      />
      <FollowUpDialog target={remind} onClose={() => setRemind(null)} />
    </>
  );
}

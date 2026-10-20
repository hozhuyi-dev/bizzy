import { useCallback, useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { isLapsed } from "./client-activity.util";
import { ClientCard, clientLink, createClientColumns } from "./clients.columns";
import { ClientsMutation } from "./clients.mutation";
import { ClientsQuery } from "./clients.query";
import { lapseFacet, lapseOf, toClientRow } from "./clients.util";
import type { ClientRow, ClientView, ClientsFilter } from "./clients.types";
import type { ListFilter } from "~/core/filter/filter.types";
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

// One facet, made once: its options never change.
const FACETS = [lapseFacet()];

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
  const activityByClient = ActivityQuery.useByClient();
  const lapse = lapseOf(filter);
  const view: ClientsFilter = lapse ? "reconnect" : "all";

  const rows = useMemo(() => {
    const now = new Date();
    const all = (clients.data ?? []).map((client) => toClientRow(client, activityByClient.get(client.id), now));
    return lapse ? all.filter((row) => isLapsed(row.client, row.activity, Number(lapse), now)) : all;
  }, [clients.data, activityByClient, lapse]);

  return (
    <>
      <PageHeader
        title={lapse ? "Reconnect" : "All clients"}
        actions={[{ type: "link", label: "New client", icon: PlusIcon, style: "primary", link: { to: "/clients/new" } }]}
        toolbar={<FilterBar label="Search clients" value={filter} onChange={onFilterChange} facets={FACETS} />}
      />

      {queryMatch(clients, {
        pending: () => <Loading />,
        error: (error) => (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ),
        // Keyed by view: each view starts from its own sort order.
        success: () => <ClientsTable key={view} view={view} rows={rows} search={filter.text} />,
      })}
    </>
  );
}

interface ClientsTableProps {
  view: ClientsFilter;
  rows: Array<ClientRow>;
  search: string;
}

function ClientsTable({ view, rows, search }: ClientsTableProps) {
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
  const columns = useMemo(() => createClientColumns(handlers), [handlers]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId: (row) => row.client.id,
    // Lapsed clients are worked through most valuable first.
    initialState: {
      sorting: reconnect ? [{ id: "lifetimeCents", desc: true }] : [{ id: "name", desc: false }],
    },
  });

  return (
    <>
      <DataTable
        table={table}
        query={search}
        rowLink={(row) => clientLink(row.client)}
        empty={
          reconnect ? (
            <EmptyState quips={QUIPS.clientsReconnect}>Nobody to get back in touch with right now.</EmptyState>
          ) : (
            <EmptyState quips={QUIPS.clients}>No clients yet. Add one, or link an unmatched calendar entry.</EmptyState>
          )
        }
        renderCard={(row) => <ClientCard row={row.original} {...handlers} />}
      />
      <FollowUpDialog target={remind} onClose={() => setRemind(null)} />
    </>
  );
}

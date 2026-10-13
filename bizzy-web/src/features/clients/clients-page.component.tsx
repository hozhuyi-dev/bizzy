import { useCallback, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { isLapsed } from "./client-activity.util";
import { ClientCard, createClientColumns } from "./clients.columns";
import { LAPSE_MONTHS } from "./clients.constant";
import { ClientsMutation } from "./clients.mutation";
import { ClientsQuery } from "./clients.query";
import { toClientRow } from "./clients.util";
import type { LapseMonths } from "./clients.constant";
import type { Client, ClientRow, ClientsView } from "./clients.types";
import type { FollowUpTarget } from "~/features/follow-ups/follow-ups.types";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.config";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { SearchInput } from "~/components/shared/search-input/search-input.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { Button } from "~/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { useWhatsApp } from "~/features/whatsapp/whatsapp.hook";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

const LAPSE_OPTIONS = LAPSE_MONTHS.map((months) => ({
  value: months,
  label: `No session in ${months} months`,
}));

interface ClientsPageProps {
  view: ClientsView;
  lapse: LapseMonths;
  onLapseChange?: (lapse: LapseMonths) => void;
}

export function ClientsPage({ view, lapse, onLapseChange }: ClientsPageProps) {
  const clients = ClientsQuery.useList();
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const now = new Date();
    const all = (clients.data ?? []).map((client) => toClientRow(client, now));
    return view === "all" ? all : all.filter((row) => isLapsed(row.client, Number(lapse), now));
  }, [clients.data, view, lapse]);

  return (
    <>
      <PageHeader
        title={view === "all" ? "All clients" : "Reconnect"}
        actions={
          <Button render={<Link to="/clients/new" />} nativeButton={false}>
            <PlusIcon /> New client
          </Button>
        }
        toolbar={
          <>
          <div className="flex flex-wrap items-center gap-2">
            {view === "reconnect" && (
              <Select
                items={LAPSE_OPTIONS}
                value={lapse}
                onValueChange={(value) => value && onLapseChange?.(value)}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LAPSE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
            <SearchInput label="Search clients" value={search} onChange={setSearch} />
          </>
        }
      />

      {queryMatch(clients, {
        pending: () => <Loading />,
        error: (error) => (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ),
        // Keyed by view: each view starts from its own sort order.
        success: () => (
          <ClientsTable key={view} view={view} rows={rows} search={search} />
        ),
      })}

    </>
  );
}

interface ClientsTableProps {
  view: ClientsView;
  rows: Array<ClientRow>;
  search: string;
}

function ClientsTable({ view, rows, search }: ClientsTableProps) {
  const { mutate: mark } = ClientsMutation.useMarkContacted();
  const reconnect = view === "reconnect";
  const [remind, setRemind] = useState<FollowUpTarget | null>(null);
  const onRemind = useCallback((client: Client) => setRemind({ mode: "new", clientId: client.id }), []);

  const onContacted = useCallback(
    (client: Client) =>
      mark(
        { id: client.id, contacted: true },
        {
          onSuccess: () =>
            toast.success(`Marked ${client.name} as contacted`, {
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
  const onWhatsApp = useCallback((client: Client) => whatsapp.message(client.contact?.phone), [whatsapp]);
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
      empty={
        reconnect ? (
          <EmptyState quips={QUIPS.clientsReconnect}>Nobody to get back in touch with right now.</EmptyState>
        ) : (
          <EmptyState quips={QUIPS.clients}>
            No clients yet. Add one, or link an unmatched calendar entry.
          </EmptyState>
        )
      }
      renderCard={(row) => (
        <ClientCard row={row.original} {...handlers} />
      )}
    />
    <FollowUpDialog target={remind} onClose={() => setRemind(null)} />
    </>
  );
}

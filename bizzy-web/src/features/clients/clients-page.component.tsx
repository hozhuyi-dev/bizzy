import { useCallback, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { isLapsed } from "./clients.activity";
import { ClientCard, createClientColumns, toClientRow } from "./clients.columns";
import { ClientsMutation } from "./clients.mutation";
import { ClientsQuery } from "./clients.query";
import type { ClientRow } from "./clients.columns";
import type { Client } from "./clients.types";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.features";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { SearchInput } from "~/components/shared/search-input/search-input.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { Button } from "~/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

export type ClientsView = "all" | "follow-up";

export const LAPSE_MONTHS = ["3", "6", "12"] as const;
export type LapseMonths = (typeof LAPSE_MONTHS)[number];

const LAPSE_OPTIONS = LAPSE_MONTHS.map((months) => ({
  value: months,
  label: `No session in ${months} months`,
}));

interface ClientsPageProps {
  view: ClientsView;
  lapse: LapseMonths;
  onViewChange: (view: ClientsView) => void;
  onLapseChange: (lapse: LapseMonths) => void;
}

export function ClientsPage({ view, lapse, onViewChange, onLapseChange }: ClientsPageProps) {
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
        title="Clients"
        actions={
          <Button render={<Link to="/clients/new" />} nativeButton={false}>
            <PlusIcon /> New client
          </Button>
        }
        toolbar={
          <>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={view} onValueChange={(value) => onViewChange(value as ClientsView)}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="follow-up">Follow up</TabsTrigger>
              </TabsList>
            </Tabs>
            {view === "follow-up" && (
              <Select
                items={LAPSE_OPTIONS}
                value={lapse}
                onValueChange={(value) => value && onLapseChange(value)}
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
      {view === "follow-up" && (
        <p className="mb-4 text-sm text-muted-foreground">
          Past clients with nothing booked, most valuable first. Marking one as contacted hides
          them for 30 days.
        </p>
      )}

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
  const followUp = view === "follow-up";

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

  const columns = useMemo(
    () => createClientColumns(followUp ? { onContacted } : {}),
    [onContacted, followUp],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId: (row) => row.client.id,
    // Follow-ups are worked through most valuable first.
    initialState: {
      sorting: followUp ? [{ id: "lifetimeCents", desc: true }] : [{ id: "name", desc: false }],
    },
  });

  return (
    <DataTable
      table={table}
      query={search}
      empty={
        followUp ? (
          <EmptyState quips={QUIPS.clientsFollowUp}>Nobody to follow up right now.</EmptyState>
        ) : (
          <EmptyState quips={QUIPS.clients}>
            No clients yet. Add one, or link an unmatched calendar entry.
          </EmptyState>
        )
      }
      renderCard={(row) => (
        <ClientCard row={row.original} {...(followUp ? { onContacted } : {})} />
      )}
    />
  );
}

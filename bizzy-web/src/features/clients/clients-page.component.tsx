import { useCallback, useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { isLapsed } from "./clients.activity";
import { ClientCard, createClientColumns, toClientRow } from "./clients.columns";
import { ClientsMutation } from "./clients.mutation";
import { ClientsQuery } from "./clients.query";
import { ClientForm } from "./components/client-form/client-form.component";
import type { ClientRow } from "./clients.columns";
import type { Client } from "./clients.types";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.features";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { queryMatch } from "~/core/utils/query.util";

type Editing = { mode: "new" } | { mode: "edit"; client: Client } | null;
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
  const [editing, setEditing] = useState<Editing>(null);
  const onEdit = useCallback((client: Client) => setEditing({ mode: "edit", client }), []);

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
          <Button onClick={() => setEditing({ mode: "new" })}>
            <PlusIcon /> New client
          </Button>
        }
        toolbar={
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
        }
      />
      {view === "follow-up" && (
        <p className="mb-4 text-sm text-muted-foreground">
          Past clients with nothing booked, most valuable first. Marking one as contacted hides
          them for 30 days.
        </p>
      )}

      {queryMatch(clients, {
        pending: () => <p className="text-sm text-muted-foreground">Loading…</p>,
        error: (error) => (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ),
        // Keyed by view: each view starts from its own sort order.
        success: () => (
          <ClientsTable key={view} view={view} rows={rows} onEdit={onEdit} />
        ),
      })}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.mode === "edit" ? "Edit client" : "New client"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <ClientForm
              // Remount per client so the form starts from that client's values.
              key={editing.mode === "edit" ? editing.client.id : "new"}
              client={editing.mode === "edit" ? editing.client : undefined}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ClientsTableProps {
  view: ClientsView;
  rows: Array<ClientRow>;
  onEdit: (client: Client) => void;
}

function ClientsTable({ view, rows, onEdit }: ClientsTableProps) {
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
    () => createClientColumns({ onEdit, ...(followUp ? { onContacted } : {}) }),
    [onEdit, onContacted, followUp],
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
      emptyMessage={
        followUp
          ? "Nobody to follow up right now."
          : "No clients yet. Add one, or link an unmatched calendar entry."
      }
      renderCard={(row) => (
        <ClientCard row={row.original} onEdit={onEdit} {...(followUp ? { onContacted } : {})} />
      )}
    />
  );
}

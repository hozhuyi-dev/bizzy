import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { createClientColumns, extraAliases } from "./clients.columns";
import { ClientsQuery } from "./clients.query";
import { ClientForm } from "./components/client-form/client-form.component";
import type { Client } from "./clients.types";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.features";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { queryMatch } from "~/core/utils/query.util";
import { formatCents } from "~/core/utils/money.util";

// Stable fallback: a fresh [] each render would rebuild the row models.
const NO_CLIENTS: Array<Client> = [];

type Editing = { mode: "new" } | { mode: "edit"; client: Client } | null;

export function ClientsPage() {
  const clients = ClientsQuery.useList();
  const [editing, setEditing] = useState<Editing>(null);

  const columns = useMemo(
    () => createClientColumns((client) => setEditing({ mode: "edit", client })),
    [],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: clients.data ?? NO_CLIENTS,
    getRowId: (client) => client.id,
    initialState: { sorting: [{ id: "name", desc: false }] },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Clients</h1>
        <Button onClick={() => setEditing({ mode: "new" })}>
          <PlusIcon /> New client
        </Button>
      </div>

      {queryMatch(clients, {
        pending: () => <p className="text-sm text-muted-foreground">Loading…</p>,
        error: (error) => (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ),
        success: () => (
          <DataTable
            table={table}
            emptyMessage="No clients yet. Add one, or link an unmatched calendar entry."
            renderCard={(row) => (
              <Card
                size="sm"
                role="button"
                tabIndex={0}
                onClick={() => setEditing({ mode: "edit", client: row.original })}
              >
                <CardContent className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{row.original.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {extraAliases(row.original).join(", ")}
                    </p>
                  </div>
                  <span className="text-sm">
                    {row.original.defaultFeeCents === undefined
                      ? "—"
                      : formatCents(row.original.defaultFeeCents)}
                  </span>
                </CardContent>
              </Card>
            )}
          />
        ),
      })}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.mode === "edit" ? "Edit client" : "New client"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <ClientForm
              // Remount per client so the form starts from that client's values.
              key={editing.mode === "edit" ? editing.client.id : "new"}
              {...(editing.mode === "edit" ? { client: editing.client } : {})}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

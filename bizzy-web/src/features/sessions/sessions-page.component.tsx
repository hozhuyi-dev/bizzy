import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { toast } from "sonner";
import { LinkClientDialog } from "./components/link-client-dialog/link-client-dialog.component";
import {
  SessionAmount,
  SessionMenu,
  SessionReceipt,
  SessionStatusCell,
  SessionWho,
  createSessionColumns,
} from "./sessions.columns";
import { SessionsMutation } from "./sessions.mutation";
import { SessionsQuery } from "./sessions.query";
import type { SessionHandlers } from "./sessions.columns";
import type { Session } from "./sessions.types";
import type { Client } from "~/features/clients/clients.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ClientForm } from "~/features/clients/components/client-form/client-form.component";
import { useCreateReceipt } from "~/features/documents/use-create-receipt";
import { PackagesQuery } from "~/features/packages/packages.query";
import { SyncButton } from "~/features/sync/sync-button.component";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.features";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { addMonths, formatMonth, formatSessionTime, monthKey } from "~/core/utils/date.util";
import { queryMatch } from "~/core/utils/query.util";

export type SessionsView = "todo" | "history";

interface SessionsPageProps {
  view: SessionsView;
  /** The history month, "2026-10". */
  month: string;
  onViewChange: (view: SessionsView) => void;
  onMonthChange: (month: string) => void;
}

// Stable fallback: a fresh [] each render would rebuild the row models.
const NO_SESSIONS: Array<Session> = [];

export function SessionsPage({ view, month, onViewChange, onMonthChange }: SessionsPageProps) {
  const [linking, setLinking] = useState<Session | null>(null);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const open = SessionsQuery.useOpen();
  const history = SessionsQuery.useMonth(month);
  const clientsById = ClientsQuery.useById();
  const packages = PackagesQuery.useList(true);
  const setIgnored = SessionsMutation.useSetIgnored();
  const { create: createReceipt } = useCreateReceipt();

  const packagesById = useMemo(
    () => new Map((packages.data ?? []).map((pkg) => [pkg.id, pkg])),
    [packages.data],
  );

  const { mutate: ignore } = setIgnored;
  const handlers = useMemo<SessionHandlers>(
    () => ({
      clientsById,
      packagesById,
      onLink: setLinking,
      onEditClient: setEditingClient,
      onIgnore: (session, ignored) =>
        ignore(
          { eventId: session.eventId, ignored },
          { onError: (error) => toast.error(error.message) },
        ),
      onReceipt: createReceipt,
    }),
    [clientsById, packagesById, ignore, createReceipt],
  );

  const columns = useMemo(() => createSessionColumns(handlers), [handlers]);
  const query = view === "todo" ? open : history;

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: query.data ?? NO_SESSIONS,
    getRowId: (session) => session.eventId,
    initialState: { sorting: [{ id: "start", desc: false }] },
  });

  const todoCount = open.data?.length;
  const thisMonth = monthKey(new Date());

  return (
    <>
      <PageHeader
        title="Sessions"
        actions={<SyncButton />}
        toolbar={
          <>
            <Tabs value={view} onValueChange={(value) => onViewChange(value as SessionsView)}>
              <TabsList>
                <TabsTrigger value="todo">To do{todoCount ? ` (${todoCount})` : ""}</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
            </Tabs>
            {view === "history" && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Previous month"
                  onClick={() => onMonthChange(addMonths(month, -1))}
                >
                  <ChevronLeftIcon />
                </Button>
                <span className="w-24 text-center text-sm font-medium">{formatMonth(month)}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Next month"
                  disabled={month >= thisMonth}
                  onClick={() => onMonthChange(addMonths(month, 1))}
                >
                  <ChevronRightIcon />
                </Button>
              </div>
            )}
          </>
        }
      />

      {queryMatch(query, {
        pending: () => <p className="text-sm text-muted-foreground">Loading…</p>,
        error: (error) => (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ),
        success: () => (
          <DataTable
            table={table}
            emptyMessage={
              view === "todo"
                ? "Nothing to do. Sessions that need a client, a fee or a fix show up here."
                : "No sessions this month."
            }
            renderCard={(row) => (
              <Card size="sm">
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <SessionWho session={row.original} clientsById={clientsById} />
                    <SessionMenu session={row.original} handlers={handlers} />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">{formatSessionTime(row.original.start)}</span>
                    <SessionAmount session={row.original} />
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <SessionStatusCell session={row.original} />
                    <SessionReceipt session={row.original} handlers={handlers} />
                  </div>
                </CardContent>
              </Card>
            )}
          />
        ),
      })}

      <LinkClientDialog session={linking} onClose={() => setLinking(null)} />

      <Dialog open={editingClient !== null} onOpenChange={(isOpen) => !isOpen && setEditingClient(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit client</DialogTitle>
          </DialogHeader>
          {editingClient && (
            <ClientForm key={editingClient.id} client={editingClient} onDone={() => setEditingClient(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

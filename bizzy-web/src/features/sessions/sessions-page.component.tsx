import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import { toast } from "sonner";
import { LinkClientDialog } from "./components/link-client-dialog/link-client-dialog.component";
import {
  SessionAmount,
  SessionReceipt,
  SessionStatusCell,
  SessionSuggestions,
  SessionWho,
  createSessionColumns,
  sessionActions,
} from "./sessions.columns";
import { SessionsMutation } from "./sessions.mutation";
import { SessionsQuery } from "./sessions.query";
import type { SessionHandlers } from "./sessions.columns";
import type { Session } from "./sessions.types";
import { ClientsMutation, profileOf } from "~/features/clients/clients.mutation";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ContactsMutation } from "~/features/contacts/contacts.query";
import { GoogleNotice } from "~/features/google/components/google-notice/google-notice.component";
import { useCreateReceipt } from "~/features/documents/use-create-receipt";
import { PackagesQuery } from "~/features/packages/packages.query";
import { SyncButton } from "~/features/sync/sync-button.component";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.features";
import { MonthPicker } from "~/components/shared/month-picker/month-picker.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { SearchInput } from "~/components/shared/search-input/search-input.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { RowActionMenu } from "~/components/shared/row-actions/row-actions.component";
import { Card, CardContent } from "~/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { formatMonth, formatSessionTime } from "~/core/utils/date.util";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

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
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const open = SessionsQuery.useOpen();
  const history = SessionsQuery.useMonth(month);
  const clientsById = ClientsQuery.useById();
  const packages = PackagesQuery.useList(true);
  const setIgnored = SessionsMutation.useSetIgnored();
  const { mutate: saveClient } = ClientsMutation.useSave();
  const { mutate: dismissContact } = ContactsMutation.useDismiss();
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
      onCreateClient: (session, contact) =>
        void navigate({
          to: "/clients/new",
          search: {
            name: session.name,
            contact: contact.resourceName,
            contactName: contact.displayName,
            from: "sessions",
          },
        }),
      onAddAlias: (session, client) => {
        const name = session.name ?? "";
        saveClient(
          { ...profileOf(client), aliases: [...client.aliases, name] },
          {
            onSuccess: () => toast.success(`“${name}” now matches ${client.name}`),
            onError: (error) => toast.error(error.message),
          },
        );
      },
      onDismissContact: (contact) =>
        dismissContact(
          { contact, dismissed: true },
          {
            onSuccess: () =>
              toast.success(`${contact.displayName} won't be suggested again`, {
                action: {
                  label: "Undo",
                  onClick: () => dismissContact({ contact, dismissed: false }),
                },
              }),
            onError: (error) => toast.error(error.message),
          },
        ),
      onEditClient: (client) =>
        void navigate({ to: "/clients/$id", params: { id: client.id }, hash: "profile" }),
      onIgnore: (session, ignored) =>
        ignore(
          { eventId: session.eventId, ignored },
          { onError: (error) => toast.error(error.message) },
        ),
      onReceipt: createReceipt,
    }),
    [clientsById, packagesById, ignore, saveClient, dismissContact, createReceipt, navigate],
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

  return (
    <>
      <PageHeader
        title="Sessions"
        actions={<SyncButton />}
        toolbar={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs value={view} onValueChange={(value) => onViewChange(value as SessionsView)}>
                <TabsList>
                  <TabsTrigger value="todo">To do{todoCount ? ` (${todoCount})` : ""}</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>
              </Tabs>
              {view === "history" && <MonthPicker value={month} onChange={onMonthChange} />}
            </div>
            <SearchInput label="Search sessions" value={search} onChange={setSearch} />
          </>
        }
      />

      <GoogleNotice />

      {queryMatch(query, {
        pending: () => <Loading />,
        error: (error) => (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ),
        success: () => (
          <DataTable
            table={table}
            query={search}
            empty={
              view === "todo" ? (
                <EmptyState key="todo" quips={QUIPS.sessionsTodo}>
                  Sessions that need a client, a fee or a fix show up here.
                </EmptyState>
              ) : (
                // Keyed by month: each empty month gets its own line.
                <EmptyState key={month} quips={QUIPS.sessionsHistory}>
                  No sessions in {formatMonth(month)}.
                </EmptyState>
              )
            }
            renderCard={(row) => (
              <Card size="sm">
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <SessionWho session={row.original} clientsById={clientsById} />
                    <RowActionMenu actions={sessionActions(row.original, handlers)} />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">{formatSessionTime(row.original.start)}</span>
                    <SessionAmount session={row.original} />
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <SessionStatusCell session={row.original} />
                    <SessionReceipt session={row.original} handlers={handlers} empty={null} />
                  </div>
                  <SessionSuggestions session={row.original} handlers={handlers} />
                </CardContent>
              </Card>
            )}
          />
        ),
      })}

      <LinkClientDialog session={linking} onClose={() => setLinking(null)} />


    </>
  );
}

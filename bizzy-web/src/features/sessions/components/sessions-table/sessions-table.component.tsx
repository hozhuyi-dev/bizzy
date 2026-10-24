import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { SessionCard, createSessionColumns, sessionLink } from "../../sessions.columns";
import { useSessionQuickActions } from "../../session-quick-actions.hook";
import { CancelSessionDialog } from "../cancel-session-dialog/cancel-session-dialog.component";
import type { ReactNode } from "react";
import type { SessionHandlers } from "../../sessions.columns";
import type { SessionHit, SessionSearch, SessionView } from "../../sessions.types";
import type { Loadable } from "~/core/utils/query.util";
import { allOf } from "~/core/utils/query.util";
import { ClientsQuery } from "~/features/clients/clients.query";
import { PackagesQuery } from "~/features/packages/packages.query";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";

interface SessionsTableProps {
  /** In the order the API found them: latest first. */
  sessions: Array<SessionHit>;
  /** Shown when there are no sessions; usually an EmptyState. */
  empty: ReactNode;
  /** What the sessions are read from: the table loads and fails in its own body (with the names and packages it shows). */
  source?: Loadable | undefined;
  /** Where the table is, for a session's page to go back to. */
  /** The session page's search: the list it steps through. */
  search?: SessionSearch | undefined;
}

/**
 * Sessions with the quick fixes the user can make to them, as wherever
 * else they are listed (useSessionQuickActions). Each links to its page,
 * where everything else is.
 */
export function SessionsTable({ sessions, empty, search, source }: SessionsTableProps) {
  const clients = ClientsQuery.useList();
  const clientsById = ClientsQuery.useById();
  const packages = PackagesQuery.useList(true);
  const quick = useSessionQuickActions();
  const [cancelling, setCancelling] = useState<SessionView | null>(null);

  const packagesById = useMemo(
    () => new Map((packages.data ?? []).map((pkg) => [pkg.id, pkg])),
    [packages.data],
  );

  const handlers = useMemo<SessionHandlers>(
    () => ({
      search,
      clientsById,
      packagesById,
      quickActions: (session) => quick(session, { page: sessionLink(session.id, search), onCancel: setCancelling }),
    }),
    [search, clientsById, packagesById, quick],
  );

  const columns = useMemo(() => createSessionColumns(handlers), [handlers]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: sessions,
    getRowId: (session) => session.id,
    // Read a page at a time, latest first: sorting a page would only sort
    // what is loaded.
    enableSorting: false,
  });

  return (
    <>
      <DataTable
        table={table}
        empty={empty}
        source={source && allOf(source, clients, packages)}
        rowLink={(session) => sessionLink(session.id, search)}
        renderCard={(row) => <SessionCard session={row.original} handlers={handlers} />}
      />
      <CancelSessionDialog
        session={cancelling}
        clientName={cancelling ? (clientsById.get(cancelling.clientId)?.name ?? cancelling.clientName) : "the client"}
        onClose={() => setCancelling(null)}
      />
    </>
  );
}

import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import { toast } from "sonner";
import { LinkClientDialog } from "../link-client-dialog/link-client-dialog.component";
import {
  SessionAmount,
  SessionDocuments,
  SessionStageCell,
  SessionWho,
  createSessionColumns,
  sessionActions,
} from "../../sessions.columns";
import { SessionsMutation } from "../../sessions.mutation";
import type { ReactNode } from "react";
import type { SessionHandlers } from "../../sessions.columns";
import type { Session, SessionReturnTo  } from "../../sessions.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { PackagesQuery } from "~/features/packages/packages.query";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.config";
import { RowActionMenu } from "~/components/shared/row-actions/row-actions.component";
import { Card, CardContent } from "~/components/ui/card";
import { formatSessionTime } from "~/core/utils/date.util";

interface SessionsTableProps {
  sessions: Array<Session>;
  /** Shown when there are no sessions; usually an EmptyState. */
  empty: ReactNode;
  query?: string | undefined;
  /** Where the table is, for a session's page to go back to. */
  from?: SessionReturnTo | undefined;
}

/**
 * Sessions with the quick fixes she can make to them: confirm, link a
 * client, or set a fee. Each links to its page, where everything else is.
 */
export function SessionsTable({ sessions, empty, query, from }: SessionsTableProps) {
  const [linking, setLinking] = useState<Session | null>(null);
  const navigate = useNavigate();

  const clientsById = ClientsQuery.useById();
  const packages = PackagesQuery.useList(true);
  const { mutate: confirm } = SessionsMutation.useConfirm();

  const packagesById = useMemo(
    () => new Map((packages.data ?? []).map((pkg) => [pkg.id, pkg])),
    [packages.data],
  );

  const handlers = useMemo<SessionHandlers>(
    () => ({
      from,
      clientsById,
      packagesById,
      onLink: setLinking,
      onEditClient: (client) =>
        void navigate({ to: "/clients/$id", params: { id: client.id }, hash: "profile" }),
      onConfirm: (session) =>
        confirm(session.eventId, {
          onSuccess: () => toast.success("Session confirmed"),
          onError: (error) => toast.error(error.message),
        }),
    }),
    [from, clientsById, packagesById, confirm, navigate],
  );

  const columns = useMemo(() => createSessionColumns(handlers), [handlers]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: sessions,
    getRowId: (session) => session.eventId,
    initialState: { sorting: [{ id: "start", desc: false }] },
  });

  return (
    <>
      <DataTable
        table={table}
        query={query}
        empty={empty}
        renderCard={(row) => (
          <Card size="sm">
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <SessionWho session={row.original} handlers={handlers} />
                <RowActionMenu actions={sessionActions(row.original, handlers)} />
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{formatSessionTime(row.original.start)}</span>
                <SessionAmount session={row.original} />
              </div>
              <div className="flex items-end justify-between gap-2">
                <SessionStageCell session={row.original} />
                <SessionDocuments session={row.original} handlers={handlers} empty={null} />
              </div>
            </CardContent>
          </Card>
        )}
      />

      <LinkClientDialog session={linking} onClose={() => setLinking(null)} />
    </>
  );
}

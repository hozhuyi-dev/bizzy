import { useMemo } from "react";
import { useTable } from "@tanstack/react-table";
import {
  SessionAmount,
  SessionDocuments,
  SessionStageCell,
  SessionWho,
  createSessionColumns,
  sessionActions,
} from "../../sessions.columns";
import { useConfirmBooking } from "../../sessions-booking.hook";
import type { ReactNode } from "react";
import type { SessionHandlers } from "../../sessions.columns";
import type { SessionReturnTo, SessionView } from "../../sessions.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { PackagesQuery } from "~/features/packages/packages.query";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.config";
import { RowActionMenu } from "~/components/shared/row-actions/row-actions.component";
import { Card, CardContent } from "~/components/ui/card";
import { formatSessionTime } from "~/core/utils/date.util";

interface SessionsTableProps {
  sessions: Array<SessionView>;
  /** Shown when there are no sessions; usually an EmptyState. */
  empty: ReactNode;
  query?: string | undefined;
  /** Where the table is, for a session's page to go back to. */
  from?: SessionReturnTo | undefined;
}

/**
 * Sessions with the quick fix she can make to them: confirm. Each links to
 * its page, where everything else is.
 */
export function SessionsTable({ sessions, empty, query, from }: SessionsTableProps) {
  const clientsById = ClientsQuery.useById();
  const packages = PackagesQuery.useList(true);
  const booking = useConfirmBooking();
  const confirm = booking.confirm;

  const packagesById = useMemo(
    () => new Map((packages.data ?? []).map((pkg) => [pkg.id, pkg])),
    [packages.data],
  );

  const handlers = useMemo<SessionHandlers>(
    () => ({
      from,
      clientsById,
      packagesById,
      onConfirm: (session) => void confirm(session.id).catch(toastRefusal),
    }),
    [from, clientsById, packagesById, confirm],
  );

  const columns = useMemo(() => createSessionColumns(handlers), [handlers]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: sessions,
    getRowId: (session) => session.id,
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
    </>
  );
}

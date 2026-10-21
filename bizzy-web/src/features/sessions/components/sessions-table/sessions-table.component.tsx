import { useMemo } from "react";
import { useTable } from "@tanstack/react-table";
import { SessionCard, createSessionColumns, sessionLink } from "../../sessions.columns";
import { useConfirmBooking } from "../../sessions-booking.hook";
import type { ReactNode } from "react";
import type { SessionHandlers } from "../../sessions.columns";
import type { SessionHit, SessionSearch } from "../../sessions.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { PackagesQuery } from "~/features/packages/packages.query";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.config";

interface SessionsTableProps {
  /** In the order the API found them: latest first. */
  sessions: Array<SessionHit>;
  /** Shown when there are no sessions; usually an EmptyState. */
  empty: ReactNode;
  /** Where the table is, for a session's page to go back to. */
  /** The session page's search: the list it steps through. */
  search?: SessionSearch | undefined;
}

/**
 * Sessions with the quick fix the user can make to them: confirm. Each
 * links to its page, where everything else is.
 */
export function SessionsTable({ sessions, empty, search }: SessionsTableProps) {
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
      search,
      clientsById,
      packagesById,
      onConfirm: (session) => void confirm(session.id).catch(toastRefusal),
    }),
    [search, clientsById, packagesById, confirm],
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
    <DataTable
      table={table}
      empty={empty}
      rowLink={(session) => sessionLink(session.id, search)}
      renderCard={(row) => <SessionCard session={row.original} handlers={handlers} />}
    />
  );
}

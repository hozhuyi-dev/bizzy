import { useMemo } from "react";
import { useTable } from "@tanstack/react-table";
import { FollowUpCard, createFollowUpColumns } from "../../follow-ups.columns";
import { useMarkDone } from "../../follow-ups.hook";
import type { ReactNode } from "react";
import type { FollowUpHandlers } from "../../follow-ups.columns";
import type { FollowUpView } from "../../follow-ups.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";

interface FollowUpsTableProps {
  /** In the order the API found them. */
  followUps: Array<FollowUpView>;
  onEdit: (followUp: FollowUpView) => void;
  /** Shown when there are none; usually an EmptyState. */
  empty: ReactNode;
}

/**
 * Follow-ups with what can be done to them in place: tick off (or back),
 * and edit. A follow-up has no page: a click on its row opens it to edit.
 */
export function FollowUpsTable({ followUps, onEdit, empty }: FollowUpsTableProps) {
  const clientsById = ClientsQuery.useById();
  const { mark, isPending } = useMarkDone();

  const handlers = useMemo<FollowUpHandlers>(
    () => ({ clientsById, onEdit, onMark: mark, marking: isPending }),
    [clientsById, onEdit, mark, isPending],
  );
  const columns = useMemo(() => createFollowUpColumns(handlers), [handlers]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: followUps,
    getRowId: (followUp) => followUp.id,
    // Read a page at a time: sorting a page would only sort what is loaded.
    enableSorting: false,
  });

  return (
    <DataTable
      table={table}
      empty={empty}
      onRowOpen={onEdit}
      renderCard={(row) => <FollowUpCard followUp={row.original} handlers={handlers} />}
    />
  );
}

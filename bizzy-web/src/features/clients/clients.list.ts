import { useMemo } from "react";
import { useTable } from "@tanstack/react-table";
import { clientSorting, createClientColumns } from "./clients.columns";
import { useClientRows } from "./clients.hook";
import { ClientsQuery } from "./clients.query";
import { CLIENT_FACETS, lapseOf } from "./clients.util";
import type { ClientRow } from "./clients.types";
import type { FilteredPagerList } from "~/core/list/pager.types";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.config";
import { shownRows } from "~/components/shared/data-table/data-table-search.util";
import { useAllWindow } from "~/core/list/pager.hook";

// Only for what each row is searched by: nothing here is shown.
const COLUMNS = createClientColumns({});

/**
 * All clients or Reconnect, for a client's page to step through: every
 * client is loaded, and read through the table's own sort and search, so
 * the order is the one the list shows before a column is clicked.
 */
export const CLIENTS_LIST: FilteredPagerList<ClientRow> = {
  noun: "client",
  nouns: "clients",
  label: "Search clients",
  useWindow: (filter) => {
    const clients = ClientsQuery.useList();
    const rows = useClientRows(filter);
    const sorting = clientSorting(lapseOf(filter) ? "reconnect" : "all");
    const table = useTable({
      features: dataTableFeatures,
      columns: COLUMNS,
      data: rows,
      getRowId: (row) => row.client.id,
      state: { sorting },
    });
    const query = filter.text;
    // The table's rows follow its data and sorting, both from these.
    const sortKey = sorting[0]?.id;
    const shown = useMemo(
      () => shownRows(table, query).map((row) => row.original),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the table reads rows and sortKey
      [table, rows, sortKey, query],
    );
    return useAllWindow(clients.isPending ? undefined : shown);
  },
  useFacets: () => CLIENT_FACETS,
  idOf: (row) => row.client.id,
};

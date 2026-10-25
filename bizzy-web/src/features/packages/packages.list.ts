import { useMemo } from "react";
import { useTable } from "@tanstack/react-table";
import { PACKAGE_SORTING, createPackageColumns } from "./packages.columns";
import { PackagesQuery } from "./packages.query";
import { matchesPackage, packageFacets } from "./packages.util";
import type { PackageView } from "./packages.types";
import type { FilteredPagerList, PagerList } from "~/core/list/pager.types";
import type { DocumentLink } from "~/features/documents/documents.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { coveringDocuments } from "~/features/documents/documents.util";
import { dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { columnIdsOf, toSorting } from "~/components/shared/list/data-table/data-table-sort.util";
import { shownRows } from "~/components/shared/list/data-table/data-table-search.util";
import { useAllWindow } from "~/core/list/pager.hook";

// Only for what each row is searched and sorted by: nothing here is shown or clicked.
const none = () => undefined;
const NO_ACTION = { type: "button", label: "", onClick: none } as const;

/**
 * The packages list, for a package's page to step through: every package
 * is loaded, and read through the table's own sort and search, so the
 * order is the one the list shows, sorted as it was left.
 */
export const PACKAGES_LIST: FilteredPagerList<PackageView> = {
  noun: "package",
  nouns: "packages",
  label: "Search packages",
  dates: true,
  useWindow: (filter) => {
    const packages = PackagesQuery.useList(true);
    const clientsById = ClientsQuery.useById();
    const columns = useMemo(
      () => createPackageColumns({ clientsById, onEdit: none, paid: () => NO_ACTION }),
      [clientsById],
    );
    // Its days and chips, as text, say when the rows change.
    const narrowing = JSON.stringify([filter.when, filter.chips]);
    const rows = useMemo(
      () => (packages.data ?? []).filter((pkg) => matchesPackage(pkg, { ...filter, text: "" })),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- narrowing is the filter's days and chips
      [packages.data, narrowing],
    );
    const sorting = toSorting(filter.sort, PACKAGE_SORTING, columnIdsOf(columns));
    const table = useTable({
      features: dataTableFeatures,
      columns,
      data: rows,
      getRowId: (pkg) => pkg.id,
      state: { sorting },
    });
    const query = filter.text;
    // The table's rows follow its data and sorting, both from these.
    const sortKey = filter.sort;
    const shown = useMemo(
      () => shownRows(table, query).map((row) => row.original),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the table reads rows and sortKey
      [table, rows, sortKey, query],
    );
    return useAllWindow(packages.isPending ? undefined : shown);
  },
  useFacets: () => {
    const clients = ClientsQuery.useList();
    return useMemo(() => packageFacets(clients.data ?? []), [clients.data]);
  },
  idOf: (pkg) => pkg.id,
};

/** A package's invoice and receipt, as its page lists them: what one opened from there steps through. */
export function packageDocumentsList(packageId: string): PagerList<DocumentLink> {
  return {
    noun: "document",
    nouns: "documents",
    useWindow: () => {
      const packages = PackagesQuery.useList(true);
      const docs = useMemo(
        () => packages.data && coveringDocuments(packages.data.find((pkg) => pkg.id === packageId)),
        [packages.data],
      );
      return useAllWindow(docs);
    },
    idOf: (doc) => doc.ref.id,
  };
}

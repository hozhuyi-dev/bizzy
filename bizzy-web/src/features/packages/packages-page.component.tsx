import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { PackageDialog } from "./components/package-dialog/package-dialog.component";
import { PackageCard, createPackageColumns } from "./packages.columns";
import { PACKAGE_PRESETS, matchesPackage, packageFacets, packagePayables } from "./packages.util";
import { PackagesQuery } from "./packages.query";
import type { PackageHandlers } from "./packages.columns";
import type { PackageTarget } from "./components/package-dialog/package-dialog.component";
import type { PackageView } from "./packages.types";
import type { ListFilter } from "~/core/list/filter.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ANOTHER_DAY, usePaidAction } from "~/features/payments/paid-action.hook";
import { useSettleReturn } from "~/features/remedies/settle.hook";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { sortingFromFilter } from "~/components/shared/list/data-table/data-table-sort.util";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { allOf } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

/** How packages sort until a column is picked: latest bought first, as every dated list. */
const LATEST_FIRST = [{ id: "purchasedAt", desc: true }];

// Stable fallback: a fresh [] each render would rebuild the row models.
const NO_PACKAGES: Array<PackageView> = [];

interface PackagesPageProps {
  /** Words, days bought, and chips: Open (by default), clients, and how far their documents have got. */
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
  /** Opens a new package for this client. */
  newFor?: string | undefined;
  /** The calendar edit it was opened to settle: once the package is added, back to the to-do list. */
  settle?: string | undefined;
}

/**
 * Prepaid packages with the credits each has left, and whether each is
 * paid. Every package is loaded already (sessions show their credits), so
 * the search, days and chips filter here, in the browser.
 */
export function PackagesPage({ filter, onFilterChange, newFor, settle }: PackagesPageProps) {
  const [editing, setEditing] = useState<PackageTarget>(newFor || settle ? { mode: "new", clientId: newFor } : null);
  const settled = useSettleReturn(settle);
  // Every package, as sessions and clients read them: one cached read, filtered here.
  const packages = PackagesQuery.useList(true);
  const clients = ClientsQuery.useList();
  const clientsById = ClientsQuery.useById();
  const facets = useMemo(() => packageFacets(clients.data ?? []), [clients.data]);
  // Routes make a new filter each render: its days and chips, as text, say when it changed.
  const narrowing = JSON.stringify([filter.when, filter.chips]);
  const rows = useMemo(() => {
    const all = packages.data ?? NO_PACKAGES;
    const [when, chips] = JSON.parse(narrowing) as [string | undefined, ListFilter["chips"]];
    return all.filter((pkg) => matchesPackage(pkg, { text: "", when, chips }));
  }, [packages.data, narrowing]);
  const paid = usePaidAction();

  const handlers = useMemo<PackageHandlers>(
    () => ({
      clientsById,
      onEdit: (pkg) => setEditing({ mode: "edit", pkg }),
      paid: (pkg) =>
        paid(
          packagePayables(pkg).filter((p) => !p.paid),
          { type: "button", label: ANOTHER_DAY, onClick: () => setEditing({ mode: "edit", pkg, at: "payment" }) },
        ),
    }),
    [clientsById, paid],
  );

  const columns = useMemo(() => createPackageColumns(handlers), [handlers]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId: (pkg) => pkg.id,
    ...sortingFromFilter(filter, onFilterChange, LATEST_FIRST, columns),
  });

  return (
    <>
      <PageHeader
        title="Packages"
        actions={[
          {
            type: "button",
            label: "New package",
            icon: PlusIcon,
            style: "primary",
            onClick: () => setEditing({ mode: "new" }),
          },
        ]}
        toolbar={
          <FilterBar
            label="Search packages"
            value={filter}
            onChange={onFilterChange}
            facets={facets}
            presets={PACKAGE_PRESETS}
            dates
          />
        }
      />

      <DataTable
            table={table}
            source={allOf(packages, clients)}
            query={filter.text}
            onRowOpen={handlers.onEdit}
            empty={
              <EmptyState quips={QUIPS.packages}>
                No packages. Write 10x85 or 10@850 after a name in the calendar, or add one here.
              </EmptyState>
            }
            renderCard={(row) => <PackageCard pkg={row.original} handlers={handlers} />}
      />

      <PackageDialog
        target={editing}
        onClose={() => setEditing(null)}
        quiet={editing?.mode === "new" && Boolean(settled)}
        onDone={editing?.mode === "new" ? settled : undefined}
      />

    </>
  );
}

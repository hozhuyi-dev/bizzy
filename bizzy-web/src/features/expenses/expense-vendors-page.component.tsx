import { useCallback, useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react";
import { toast } from "sonner";
import { ExpensesMutation } from "./expenses.mutation";
import { ExpensesQuery } from "./expenses.query";
import type { Vendor } from "./expenses.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { createDataTableColumnHelper, dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { RowActions } from "~/components/shared/actions/row-actions/row-actions.component";
import { DataCard } from "~/components/shared/list/data-card/data-card.component";
import { SearchInput } from "~/components/shared/list/search-input/search-input.component";
import { Badge } from "~/components/ui/badge";
import { formatDate } from "~/core/utils/date.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

const NO_VENDORS: Array<Vendor> = [];

const helper = createDataTableColumnHelper<Vendor>();

/**
 * The shops and websites the user buys from, suggested on the next
 * receipt. They are added as new ones are typed on an expense; here a
 * typo or one no longer used is archived, out of the suggestions.
 */
export function ExpenseVendorsPage() {
  const [search, setSearch] = useState("");
  const catalogue = ExpensesQuery.useCatalogue();
  const { mutate: archive } = ExpensesMutation.useArchiveVendor();

  // Archive, or unarchive, behind the row's ⋯.
  const toggle = useCallback(
    (vendor: Vendor): Action =>
    vendor.archived
      ? {
          type: "button",
          label: "Unarchive",
          icon: ArchiveRestoreIcon,
          onClick: () =>
            archive(
              { id: vendor.id, archived: false },
              { onSuccess: () => toast.success(`${vendor.name} is suggested again`), onError: toastRefusal },
            ),
        }
      : {
          type: "button",
          label: "Archive",
          icon: ArchiveIcon,
          onClick: () =>
            archive(
              { id: vendor.id, archived: true },
              { onSuccess: () => toast.success(`${vendor.name} archived`), onError: toastRefusal },
            ),
        },
    [archive],
  );

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("name", {
          header: "Shop",
          sortFn: "alphanumeric",
          meta: { width: "grow" },
          cell: ({ row }) => (
            <span className="flex flex-wrap items-center gap-1.5">
              {row.original.name}
              {row.original.archived && <Badge variant="neutral">Archived</Badge>}
            </span>
          ),
        }),
        helper.accessor("lastUsed", {
          header: "Last receipt",
          sortFn: "alphanumeric",
          cell: ({ getValue }) => formatDate(getValue()),
        }),
        helper.display({
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          meta: { width: "fit" },
          cell: ({ row }) => <RowActions actions={[]} more={[toggle(row.original)]} />,
        }),
      ]),
    [toggle],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: catalogue.data?.vendors ?? NO_VENDORS,
    getRowId: (vendor) => vendor.id,
    initialState: { sorting: [{ id: "lastUsed", desc: true }] },
  });

  return (
    <>
      <PageHeader title="Shops" toolbar={<SearchInput label="Search shops" value={search} onChange={setSearch} />} />
      <DataTable
          table={table}
          source={catalogue}
          query={search}
          empty={<EmptyState quips={QUIPS.expenses}>No shops yet. They're added as you record expenses.</EmptyState>}
          renderCard={(row) => (
            <DataCard
              title={
                <>
                  <span className="font-medium">{row.original.name}</span>
                  {row.original.archived && <Badge variant="neutral">Archived</Badge>}
                </>
              }
              meta={`Last receipt ${formatDate(row.original.lastUsed)}`}
              more={[toggle(row.original)]}
            />
          )}
        />
    </>
  );
}

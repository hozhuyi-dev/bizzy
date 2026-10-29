import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import { ExpensesQuery } from "./expenses.query";
import { CATALOGUE_FACETS, CATALOGUE_PRESETS, listsArchived } from "./expenses.util";
import type { Vendor } from "./expenses.types";
import type { ListFilter } from "~/core/list/filter.types";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { createDataTableColumnHelper, dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { DataCard } from "~/components/shared/list/data-card/data-card.component";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { formatDate } from "~/core/utils/date.util";
import { presetLabel } from "~/core/list/filter.util";
import { QUIPS } from "~/core/constants/quips.constant";

const NO_VENDORS: Array<Vendor> = [];

const helper = createDataTableColumnHelper<Vendor>();

interface ExpenseVendorsPageProps {
  /** Words, and whether it lists the archived ones. */
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * The shops and websites the user buys from, suggested on the next
 * receipt. They are added as new ones are typed on an expense; each opens
 * on its own page, to be renamed or archived, out of the suggestions.
 * Receipts keep what was typed on them. The archived ones are listed only
 * under their preset.
 */
export function ExpenseVendorsPage({ filter, onFilterChange }: ExpenseVendorsPageProps) {
  const navigate = useNavigate();
  const open = (vendor: Vendor) => void navigate({ to: "/expenses/vendors/$id", params: { id: vendor.id } });
  const catalogue = ExpensesQuery.useCatalogue();
  const vendors = catalogue.data?.vendors;
  const archived = listsArchived(filter);
  const rows = useMemo(() => (vendors ?? NO_VENDORS).filter((vendor) => Boolean(vendor.archived) === archived), [vendors, archived]);

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("name", { header: "Shop", sortFn: "alphanumeric", meta: { width: "grow" } }),
        helper.accessor("lastUsed", {
          header: "Last receipt",
          sortFn: "alphanumeric",
          cell: ({ getValue }) => formatDate(getValue()),
        }),
      ]),
    [],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId: (vendor) => vendor.id,
    initialState: { sorting: [{ id: "lastUsed", desc: true }] },
  });

  return (
    <>
      <PageHeader
        title="Shops"
        subtitle={presetLabel(filter, CATALOGUE_PRESETS)}
        toolbar={
          <FilterBar label="Search shops" value={filter} onChange={onFilterChange} facets={CATALOGUE_FACETS} presets={CATALOGUE_PRESETS} />
        }
      />
      <DataTable
        table={table}
        source={catalogue}
        query={filter.text}
        onRowOpen={open}
        empty={
          archived ? (
            <EmptyState quips={QUIPS.expenses}>No archived shops.</EmptyState>
          ) : (
            <EmptyState quips={QUIPS.expenses}>No shops yet. They're added as you record expenses.</EmptyState>
          )
        }
        renderCard={(row) => (
          <DataCard
            title={<span className="font-medium">{row.original.name}</span>}
            meta={`Last receipt ${formatDate(row.original.lastUsed)}`}
            onOpen={() => open(row.original)}
          />
        )}
      />
    </>
  );
}

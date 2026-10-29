import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import { ExpensesQuery } from "./expenses.query";
import { CATALOGUE_FACETS, CATALOGUE_PRESETS, listsArchived } from "./expenses.util";
import type { ExpenseItem } from "./expenses.types";
import type { ListFilter } from "~/core/list/filter.types";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { createDataTableColumnHelper, dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { CellEmpty } from "~/components/shared/list/data-table/data-table-cell.component";
import { DataCard } from "~/components/shared/list/data-card/data-card.component";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { formatCents } from "~/core/utils/money.util";
import { presetLabel } from "~/core/list/filter.util";
import { QUIPS } from "~/core/constants/quips.constant";

const NO_ITEMS: Array<ExpenseItem> = [];

const helper = createDataTableColumnHelper<ExpenseItem>();

interface ExpenseItemsPageProps {
  /** Words, and whether it lists the archived ones. */
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * The things the user buys, suggested on a line as its name is typed.
 * Items are added as new names are typed on an expense; each opens on its
 * own page, to be renamed, given another category for its next line, or
 * archived, out of the suggestions. Receipts keep what was typed on them.
 * The archived ones are listed only under their preset.
 */
export function ExpenseItemsPage({ filter, onFilterChange }: ExpenseItemsPageProps) {
  const navigate = useNavigate();
  const open = (item: ExpenseItem) => void navigate({ to: "/expenses/items/$id", params: { id: item.id } });
  const catalogue = ExpensesQuery.useCatalogue();
  const items = catalogue.data?.items;
  const archived = listsArchived(filter);
  const rows = useMemo(() => (items ?? NO_ITEMS).filter((item) => Boolean(item.archived) === archived), [items, archived]);
  const categoryName = useMemo(() => {
    const names = new Map((catalogue.data?.categories ?? []).map((c) => [c.id, c.name]));
    return (item: ExpenseItem) => names.get(item.categoryId) ?? "—";
  }, [catalogue.data]);
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("name", { header: "Item", sortFn: "alphanumeric", meta: { width: "grow" } }),
        helper.accessor((item) => categoryName(item), { id: "category", header: "Category", sortFn: "alphanumeric" }),
        helper.accessor((item) => item.lastAmountCents, {
          id: "last",
          header: "Last paid",
          sortFn: "basic",
          sortUndefined: "last",
          meta: { align: "end" },
          cell: ({ getValue }) => {
            const cents = getValue();
            return cents === undefined ? <CellEmpty /> : formatCents(cents);
          },
        }),
      ]),
    [categoryName],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId: (item) => item.id,
    initialState: { sorting: [{ id: "name", desc: false }] },
  });

  return (
    <>
      <PageHeader
        title="Items"
        subtitle={presetLabel(filter, CATALOGUE_PRESETS)}
        toolbar={
          <FilterBar label="Search items" value={filter} onChange={onFilterChange} facets={CATALOGUE_FACETS} presets={CATALOGUE_PRESETS} />
        }
      />
      <DataTable
        table={table}
        source={catalogue}
        query={filter.text}
        onRowOpen={open}
        empty={
          archived ? (
            <EmptyState quips={QUIPS.expenses}>No archived items.</EmptyState>
          ) : (
            <EmptyState quips={QUIPS.expenses}>No items yet. They're added as you record expenses.</EmptyState>
          )
        }
        renderCard={(row) => (
          <DataCard
            title={<span className="font-medium">{row.original.name}</span>}
            value={row.original.lastAmountCents === undefined ? undefined : formatCents(row.original.lastAmountCents)}
            meta={categoryName(row.original)}
            onOpen={() => open(row.original)}
          />
        )}
      />
    </>
  );
}

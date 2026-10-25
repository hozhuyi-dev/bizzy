import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import { ExpensesQuery } from "./expenses.query";
import type { ExpenseItem } from "./expenses.types";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { createDataTableColumnHelper, dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { CellEmpty } from "~/components/shared/list/data-table/data-table-cell.component";
import { DataCard } from "~/components/shared/list/data-card/data-card.component";
import { SearchInput } from "~/components/shared/list/search-input/search-input.component";
import { Badge } from "~/components/ui/badge";
import { formatCents } from "~/core/utils/money.util";
import { QUIPS } from "~/core/constants/quips.constant";

const NO_ITEMS: Array<ExpenseItem> = [];

const helper = createDataTableColumnHelper<ExpenseItem>();

/**
 * The things the user buys, which lines are picked from. Items are added
 * as new ones are typed on an expense; each opens on its own page, to be
 * renamed, moved to another category for lines from now on, or archived.
 */
export function ExpenseItemsPage() {
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const open = (item: ExpenseItem) => void navigate({ to: "/expenses/items/$id", params: { id: item.id } });
  const catalogue = ExpensesQuery.useCatalogue();
  const categoryName = useMemo(() => {
    const names = new Map((catalogue.data?.categories ?? []).map((c) => [c.id, c.name]));
    return (item: ExpenseItem) => names.get(item.categoryId) ?? "—";
  }, [catalogue.data]);
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("name", {
          header: "Item",
          sortFn: "alphanumeric",
          meta: { width: "grow" },
          cell: ({ row }) => (
            <span className="flex flex-wrap items-center gap-1.5">
              {row.original.name}
              {row.original.archived && <Badge variant="neutral">Archived</Badge>}
            </span>
          ),
        }),
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
    data: catalogue.data?.items ?? NO_ITEMS,
    getRowId: (item) => item.id,
    initialState: { sorting: [{ id: "name", desc: false }] },
  });

  return (
    <>
      <PageHeader title="Items" toolbar={<SearchInput label="Search items" value={search} onChange={setSearch} />} />
      <DataTable
          table={table}
          source={catalogue}
          query={search}
          onRowOpen={open}
          empty={<EmptyState quips={QUIPS.expenses}>No items yet. They're added as you record expenses.</EmptyState>}
          renderCard={(row) => (
            <DataCard
              title={
                <>
                  <span className="font-medium">{row.original.name}</span>
                  {row.original.archived && <Badge variant="neutral">Archived</Badge>}
                </>
              }
              value={row.original.lastAmountCents === undefined ? undefined : formatCents(row.original.lastAmountCents)}
              meta={categoryName(row.original)}
              onOpen={() => open(row.original)}
            />
          )}
        />
    </>
  );
}

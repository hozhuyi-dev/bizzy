import { useMemo } from "react";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { cn } from "cn";
import { ExpenseCard, createExpenseColumns, expenseLink } from "./expenses.columns";
import { ExpensesQuery } from "./expenses.query";
import { expenseFacets, expensePresets, expensesUrl } from "./expenses.util";
import type { ListFilter } from "~/core/list/filter.types";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { LoadMore } from "~/components/shared/list/load-more/load-more.component";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { formatWhen, isNarrowed, pageItems } from "~/core/list/filter.util";
import { formatCents } from "~/core/utils/money.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { allOf } from "~/core/utils/query.util";

interface ExpensesPageProps {
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * Receipts, latest first, searched on the server a page at a time, with
 * what those found add up to. A year at a glance, by category as the tax
 * return asks, is on Insights.
 */
export function ExpensesPage({ filter, onFilterChange }: ExpensesPageProps) {
  const expenses = ExpensesQuery.useSearch(filter);
  const catalogue = ExpensesQuery.useCatalogue();
  const facets = useMemo(() => expenseFacets(catalogue.data), [catalogue.data]);
  const presets = useMemo(() => expensePresets(), []);
  // Each expense's page steps through this list.
  const search = useMemo(() => expensesUrl.toSearch(filter), [filter]);
  const columns = useMemo(() => createExpenseColumns(catalogue.data, search), [catalogue.data, search]);
  const data = useMemo(() => pageItems(expenses.data), [expenses.data]);
  const totals = expenses.data?.pages[0]?.totals;

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId: (expense) => expense.id,
    // Read a page at a time, latest first: sorting a page would only sort
    // what is loaded.
    enableSorting: false,
  });

  return (
    <>
      <PageHeader
        title="Expenses"
        actions={[
          { type: "link", label: "New expense", icon: PlusIcon, style: "primary", link: { to: "/expenses/new" } },
        ]}
        toolbar={
          <FilterBar
            label="Search expenses"
            value={filter}
            onChange={onFilterChange}
            facets={facets}
            presets={presets}
            dates
          />
        }
      />

      <div className={cn("flex flex-col gap-2 transition-opacity", expenses.isPlaceholderData && "opacity-60")}>
          {totals && totals.count > 0 && (
            <p className="text-sm text-muted-foreground">
              {totals.count} {totals.count === 1 ? "expense" : "expenses"}
              {filter.when ? ` in ${formatWhen(filter.when)}` : ""} ·{" "}
              <span className="font-medium text-foreground tabular-nums">{formatCents(totals.spentCents)}</span>
            </p>
          )}
          <DataTable
            table={table}
            source={allOf(expenses, catalogue)}
            rowLink={(expense) => expenseLink(expense.id, search)}
            empty={
              isNarrowed(filter) || expenses.hasNextPage ? (
                <EmptyState quips={QUIPS.search}>No expenses found{expenses.hasNextPage ? " yet" : ""}.</EmptyState>
              ) : (
                <EmptyState quips={QUIPS.expenses}>
                  No expenses{filter.when ? ` in ${formatWhen(filter.when)}` : " yet"}. Add one with its receipt.
                </EmptyState>
              )
            }
            renderCard={(row) => <ExpenseCard expense={row.original} catalogue={catalogue.data} search={search} />}
          />
          <LoadMore pages={expenses} found={data.length > 0} />
        </div>
    </>
  );
}

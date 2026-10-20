import { useMemo } from "react";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { cn } from "cn";
import { ExpenseCard, createExpenseColumns, expenseLink } from "./expenses.columns";
import { ExpensesQuery } from "./expenses.query";
import { expenseFacets, totalsByCategory } from "./expenses.util";
import type { ExpenseTotals } from "./expenses.types";
import type { ListFilter, When } from "~/core/filter/filter.types";
import { ActivityQuery } from "~/features/activity/activity.query";
import { monthTotals } from "~/features/insights/insights-metrics.util";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.config";
import { FilterBar } from "~/components/shared/filter-bar/filter-bar.component";
import { LoadMore } from "~/components/shared/load-more/load-more.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { formatWhen, isNarrowed, pageItems, whenDays } from "~/core/filter/filter.util";
import { formatCents } from "~/core/utils/money.util";
import { QUIPS } from "~/core/constants/quips.constant";

interface ExpensesPageProps {
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * Receipts, latest first, searched on the server a page at a time: what
 * was spent, on what (by Form B category, as the tax return asks), and,
 * over the days shown, what is left of the money received.
 */
export function ExpensesPage({ filter, onFilterChange }: ExpensesPageProps) {
  const expenses = ExpensesQuery.useSearch(filter);
  const catalogue = ExpensesQuery.useCatalogue();
  const facets = useMemo(() => expenseFacets(catalogue.data), [catalogue.data]);
  const columns = useMemo(() => createExpenseColumns(catalogue.data), [catalogue.data]);
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
        toolbar={<FilterBar label="Search expenses" value={filter} onChange={onFilterChange} facets={facets} dates />}
      />

      {expenses.isPending ? (
        <Loading />
      ) : expenses.error ? (
        <p role="alert" className="text-sm text-destructive">
          {expenses.error.message}
        </p>
      ) : (
        <div className={cn("flex flex-col gap-6 transition-opacity", expenses.isPlaceholderData && "opacity-60")}>
          {totals && <Summary when={filter.when} totals={totals} narrowed={isNarrowed(filter)} />}
          {catalogue.data && totals && totals.spentCents > 0 && (
            <CategoryTotals totals={totalsByCategory(totals.byCategory, catalogue.data)} />
          )}
          <div>
            <DataTable
              table={table}
              rowLink={expenseLink}
              empty={
                isNarrowed(filter) || expenses.hasNextPage ? (
                  <EmptyState quips={QUIPS.search}>No expenses found{expenses.hasNextPage ? " yet" : ""}.</EmptyState>
                ) : (
                  <EmptyState quips={QUIPS.expenses}>
                    No expenses{filter.when ? ` in ${formatWhen(filter.when)}` : " yet"}. Add one with its receipt.
                  </EmptyState>
                )
              }
              renderCard={(row) => <ExpenseCard expense={row.original} catalogue={catalogue.data} />}
            />
            <LoadMore pages={expenses} found={data.length > 0} />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * What the expenses found add up to and, over the days shown (all time
 * without any), what was received and is left. Received is by the month,
 * so days picked inside a month count all of it. Searching words or
 * categories leaves received out: it isn't theirs.
 */
function Summary({ when, totals, narrowed }: { when: When | undefined; totals: ExpenseTotals; narrowed: boolean }) {
  const activity = ActivityQuery.useList();
  const received = useMemo(() => {
    const days = when ? whenDays(when) : undefined;
    let cents = 0;
    for (const [month, total] of monthTotals(activity.data ?? [])) {
      if (!days || (month >= days.from.slice(0, 7) && month <= days.to.slice(0, 7))) cents += total.received;
    }
    return cents;
  }, [activity.data, when]);

  return (
    <dl className="grid grid-cols-3 gap-3">
      <Stat label="Spent" value={formatCents(totals.spentCents)} />
      {!narrowed && (
        <>
          <Stat label="Received" value={activity.data ? formatCents(received) : "…"} />
          <Stat label="Left" value={activity.data ? formatCents(received - totals.spentCents) : "…"} />
        </>
      )}
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-0.5">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      </CardContent>
    </Card>
  );
}

function CategoryTotals({ totals }: { totals: ReturnType<typeof totalsByCategory> }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">By category</h2>
      <ul className="flex flex-col divide-y overflow-hidden rounded-xl bg-card text-sm ring-1 ring-foreground/10">
        {totals.map(({ category, cents }) => (
          <li key={category.id} className="flex h-10 items-center justify-between gap-2 px-4">
            <span className="flex flex-wrap items-center gap-1.5">
              {category.name}
              {category.capital && <Badge variant="info">Capital allowance</Badge>}
            </span>
            <span className="tabular-nums">{formatCents(cents)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

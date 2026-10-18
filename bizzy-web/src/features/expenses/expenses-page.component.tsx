import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { ExpenseLink, ExpenseReceipt, createExpenseColumns } from "./expenses.columns";
import { ExpensesQuery } from "./expenses.query";
import { linesSummary, totalsByCategory } from "./expenses.util";
import type { ExpenseView } from "./expenses.types";
import { ActivityQuery } from "~/features/activity/activity.query";
import { monthTotals } from "~/features/insights/insights-metrics.util";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.config";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { SearchInput } from "~/components/shared/search-input/search-input.component";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { formatCents } from "~/core/utils/money.util";
import { QUIPS } from "~/core/constants/quips.constant";

// Stable fallback: a fresh [] each render would rebuild the row models.
const NO_EXPENSES: Array<ExpenseView> = [];

interface ExpensesPageProps {
  year: number;
  onYearChange: (year: number) => void;
}

/**
 * A year of receipts: what was spent, on what (by Form B category, as the
 * tax return asks), and what is left of the money received.
 */
export function ExpensesPage({ year, onYearChange }: ExpensesPageProps) {
  const [search, setSearch] = useState("");
  const expenses = ExpensesQuery.useYear(year);
  const catalogue = ExpensesQuery.useCatalogue();
  const columns = useMemo(() => createExpenseColumns(), []);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: expenses.data ?? NO_EXPENSES,
    getRowId: (expense) => expense.id,
    initialState: { sorting: [{ id: "date", desc: true }] },
  });

  return (
    <>
      <PageHeader
        title="Expenses"
        actions={[
          { type: "link", label: "New expense", icon: PlusIcon, style: "primary", link: { to: "/expenses/new" } },
        ]}
        toolbar={
          <>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Previous year" onClick={() => onYearChange(year - 1)}>
                <ChevronLeftIcon />
              </Button>
              <span className="w-12 text-center text-sm font-medium tabular-nums">{year}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next year"
                disabled={year >= new Date().getFullYear()}
                onClick={() => onYearChange(year + 1)}
              >
                <ChevronRightIcon />
              </Button>
            </div>
            <SearchInput label="Search expenses" value={search} onChange={setSearch} />
          </>
        }
      />

      {expenses.isPending ? (
        <Loading />
      ) : expenses.error ? (
        <p role="alert" className="text-sm text-destructive">
          {expenses.error.message}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <YearSummary year={year} expenses={expenses.data} />
          {catalogue.data && expenses.data.length > 0 && (
            <CategoryTotals totals={totalsByCategory(expenses.data, catalogue.data)} />
          )}
          <DataTable
            table={table}
            query={search}
            empty={<EmptyState quips={QUIPS.expenses}>No expenses in {year}. Add one with its receipt.</EmptyState>}
            renderCard={(row) => (
              <Card size="sm">
                <CardContent className="flex flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex flex-col">
                      <ExpenseLink expense={row.original} />
                      <span className="text-xs text-muted-foreground">{row.original.vendor}</span>
                    </span>
                    <span className="font-medium tabular-nums">{formatCents(row.original.totalCents)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-muted-foreground">{linesSummary(row.original)}</span>
                    <ExpenseReceipt expense={row.original} />
                  </div>
                </CardContent>
              </Card>
            )}
          />
        </div>
      )}
    </>
  );
}

/** Spent, received and what is left, over the calendar year. */
function YearSummary({ year, expenses }: { year: number; expenses: ReadonlyArray<ExpenseView> }) {
  const activity = ActivityQuery.useList();
  const spent = expenses.reduce((sum, expense) => sum + expense.totalCents, 0);
  const received = useMemo(() => {
    let cents = 0;
    for (const [month, total] of monthTotals(activity.data ?? [])) {
      if (month.startsWith(`${year}-`)) cents += total.received;
    }
    return cents;
  }, [activity.data, year]);

  return (
    <dl className="grid grid-cols-3 gap-3">
      <Stat label="Spent" value={formatCents(spent)} />
      <Stat label="Received" value={activity.data ? formatCents(received) : "…"} />
      <Stat label="Left" value={activity.data ? formatCents(received - spent) : "…"} />
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
      <ul className="flex flex-col divide-y rounded-md border text-sm">
        {totals.map(({ category, cents }) => (
          <li key={category.id} className="flex items-center justify-between gap-2 px-3 py-2">
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

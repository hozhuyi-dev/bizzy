import { createFileRoute } from "@tanstack/react-router";
import type { FilterSearch } from "~/core/filter/filter.types";
import { ExpensesPage } from "~/features/expenses/expenses-page.component";
import { EXPENSE_FACETS } from "~/features/expenses/expenses.constant";
import { filterSearch, toFilter, toSearch } from "~/core/filter/filter.util";

export type ExpensesSearch = FilterSearch<(typeof EXPENSE_FACETS)[number]>;

export const Route = createFileRoute("/expenses/")({
  validateSearch: (search: Record<string, unknown>): ExpensesSearch => filterSearch(search, EXPENSE_FACETS),
  component: ExpensesRoute,
});

function ExpensesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // This year, the tax year, unless the URL says otherwise.
  const thisYear = String(new Date().getFullYear());
  const filter = toFilter(search, EXPENSE_FACETS, thisYear);

  return (
    <ExpensesPage
      filter={filter}
      onFilterChange={(next) =>
        void navigate({ search: toSearch(next, EXPENSE_FACETS, thisYear), replace: next.text !== filter.text })
      }
    />
  );
}

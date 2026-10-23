import { createFileRoute } from "@tanstack/react-router";
import type { ExpensesSearch } from "~/features/expenses/expenses.types";
import { ExpensesPage } from "~/features/expenses/expenses-page.component";
import { expensesUrl } from "~/features/expenses/expenses.util";

export const Route = createFileRoute("/expenses/")({
  validateSearch: (search: Record<string, unknown>): ExpensesSearch => expensesUrl.validate(search),
  component: ExpensesRoute,
});

function ExpensesRoute() {
  const navigate = Route.useNavigate();
  // This year, the tax year, unless the URL says otherwise.
  const filter = expensesUrl.toFilter(Route.useSearch());

  return (
    <ExpensesPage
      filter={filter}
      onFilterChange={(next) =>
        void navigate({ search: expensesUrl.toSearch(next), replace: next.text !== filter.text })
      }
    />
  );
}

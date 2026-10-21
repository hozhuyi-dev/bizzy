import { createFileRoute } from "@tanstack/react-router";
import type { ExpensesSearch } from "~/features/expenses/expenses.types";
import { ExpensePage } from "~/features/expenses/expense-page.component";
import { expensesUrl } from "~/features/expenses/expenses.util";

export const Route = createFileRoute("/expenses/$id")({
  // The expenses list it steps through.
  validateSearch: (search: Record<string, unknown>): ExpensesSearch => expensesUrl.validate(search),
  component: ExpenseRoute,
});

function ExpenseRoute() {
  const { id } = Route.useParams();
  const navigate = Route.useNavigate();
  return (
    <ExpensePage
      key={id}
      mode="edit"
      id={id}
      filter={expensesUrl.toFilter(Route.useSearch())}
      // A new list to step through replaces the entry: Back still returns to the list.
      onFilterChange={(next) => void navigate({ search: expensesUrl.toSearch(next), replace: true })}
    />
  );
}

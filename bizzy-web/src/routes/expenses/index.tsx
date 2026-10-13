import { createFileRoute } from "@tanstack/react-router";
import { ExpensesPage } from "~/features/expenses/expenses-page.component";
import { yearParam } from "~/core/utils/search.util";

export interface ExpensesSearch {
  year?: number | undefined;
}

export const Route = createFileRoute("/expenses/")({
  validateSearch: (search: Record<string, unknown>): ExpensesSearch => ({
    year: yearParam(search.year),
  }),
  component: ExpensesRoute,
});

function ExpensesRoute() {
  const { year } = Route.useSearch();
  const navigate = Route.useNavigate();
  const thisYear = new Date().getFullYear();

  return (
    <ExpensesPage
      year={year ?? thisYear}
      onYearChange={(next) => void navigate({ search: { year: next === thisYear ? undefined : next } })}
    />
  );
}

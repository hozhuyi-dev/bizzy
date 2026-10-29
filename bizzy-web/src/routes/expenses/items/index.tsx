import { createFileRoute } from "@tanstack/react-router";
import type { CatalogueSearch } from "~/features/expenses/expenses.types";
import { ExpenseItemsPage } from "~/features/expenses/expense-items-page.component";
import { useCatalogueNavigate } from "~/features/expenses/expenses.hook";
import { catalogueUrl } from "~/features/expenses/expenses.util";

export const Route = createFileRoute("/expenses/items/")({
  validateSearch: (search: Record<string, unknown>): CatalogueSearch => catalogueUrl.validate(search),
  component: ExpenseItemsRoute,
});

function ExpenseItemsRoute() {
  const filter = catalogueUrl.toFilter(Route.useSearch());
  return <ExpenseItemsPage filter={filter} onFilterChange={useCatalogueNavigate("/expenses/items", filter)} />;
}

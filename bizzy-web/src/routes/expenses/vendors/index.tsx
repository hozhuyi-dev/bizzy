import { createFileRoute } from "@tanstack/react-router";
import type { CatalogueSearch } from "~/features/expenses/expenses.types";
import { ExpenseVendorsPage } from "~/features/expenses/expense-vendors-page.component";
import { useCatalogueNavigate } from "~/features/expenses/expenses.hook";
import { catalogueUrl } from "~/features/expenses/expenses.util";

export const Route = createFileRoute("/expenses/vendors/")({
  validateSearch: (search: Record<string, unknown>): CatalogueSearch => catalogueUrl.validate(search),
  component: ExpenseVendorsRoute,
});

function ExpenseVendorsRoute() {
  const filter = catalogueUrl.toFilter(Route.useSearch());
  return <ExpenseVendorsPage filter={filter} onFilterChange={useCatalogueNavigate("/expenses/vendors", filter)} />;
}

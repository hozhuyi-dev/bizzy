import { createFileRoute } from "@tanstack/react-router";
import { ExpenseVendorPage } from "~/features/expenses/expense-vendor-page.component";
import { ExpensesQuery } from "~/features/expenses/expenses.query";
import { pageData, prefetch } from "~/core/utils/page-data.util";

export const Route = createFileRoute("/expenses/vendors/$id")({
  loader: () => pageData(prefetch(ExpensesQuery.catalogue())),
  component: ExpenseVendorRoute,
});

function ExpenseVendorRoute() {
  const { id } = Route.useParams();
  return <ExpenseVendorPage key={id} id={id} />;
}

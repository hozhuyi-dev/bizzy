import { createFileRoute } from "@tanstack/react-router";
import { ExpenseItemPage } from "~/features/expenses/expense-item-page.component";
import { ExpensesQuery } from "~/features/expenses/expenses.query";
import { pageData, prefetch } from "~/core/utils/page-data.util";

export const Route = createFileRoute("/expenses/items/$id")({
  loader: () => pageData(prefetch(ExpensesQuery.catalogue())),
  component: ExpenseItemRoute,
});

function ExpenseItemRoute() {
  const { id } = Route.useParams();
  return <ExpenseItemPage key={id} id={id} />;
}

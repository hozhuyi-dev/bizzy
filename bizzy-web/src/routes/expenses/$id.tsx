import { createFileRoute } from "@tanstack/react-router";
import { ExpensePage } from "~/features/expenses/expense-page.component";

export const Route = createFileRoute("/expenses/$id")({
  component: ExpenseRoute,
});

function ExpenseRoute() {
  const { id } = Route.useParams();
  return <ExpensePage key={id} mode="edit" id={id} />;
}

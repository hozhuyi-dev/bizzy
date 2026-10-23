import { createFileRoute } from "@tanstack/react-router";
import { ExpensePage } from "~/features/expenses/expense-page.component";

export const Route = createFileRoute("/expenses/new")({
  component: () => <ExpensePage mode="new" />,
});

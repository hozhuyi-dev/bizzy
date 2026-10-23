import { createFileRoute } from "@tanstack/react-router";
import { ExpenseItemsPage } from "~/features/expenses/expense-items-page.component";

export const Route = createFileRoute("/expenses/items")({
  component: ExpenseItemsPage,
});

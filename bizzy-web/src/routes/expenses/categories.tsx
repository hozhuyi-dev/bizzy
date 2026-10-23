import { createFileRoute } from "@tanstack/react-router";
import { ExpenseCategoriesPage } from "~/features/expenses/expense-categories-page.component";

export const Route = createFileRoute("/expenses/categories")({
  component: ExpenseCategoriesPage,
});

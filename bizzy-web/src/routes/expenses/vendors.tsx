import { createFileRoute } from "@tanstack/react-router";
import { ExpenseVendorsPage } from "~/features/expenses/expense-vendors-page.component";

export const Route = createFileRoute("/expenses/vendors")({
  component: ExpenseVendorsPage,
});

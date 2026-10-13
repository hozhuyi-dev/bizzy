import { PaperclipIcon } from "lucide-react";
import { linesSummary } from "./expenses.util";
import type { Expense } from "./expenses.types";
import { Badge } from "~/components/ui/badge";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.config";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { formatDate } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

const helper = createDataTableColumnHelper<Expense>();

/** Whether the receipt is attached: kept for the tax return. */
export function ExpenseReceipt({ expense }: { expense: Expense }) {
  const files = expense.files ?? 0;
  if (files === 0) return <Badge variant="neutral">No receipt</Badge>;
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
      <PaperclipIcon className="size-3.5" aria-hidden="true" />
      {files === 1 ? "Receipt" : `${files} files`}
    </span>
  );
}

export function ExpenseLink({ expense }: { expense: Expense }) {
  return (
    <TextLink to="/expenses/$id" params={{ id: expense.id }}>
      {formatDate(expense.date)}
    </TextLink>
  );
}

export function createExpenseColumns() {
  return helper.columns([
    helper.accessor("date", {
      header: "Date",
      sortFn: "basic",
      meta: { search: (expense: Expense) => formatDate(expense.date) },
      cell: ({ row }) => <ExpenseLink expense={row.original} />,
    }),
    helper.accessor((expense) => expense.vendor ?? "", {
      id: "vendor",
      header: "Where",
      sortFn: "alphanumeric",
      cell: ({ getValue }) => getValue() || <span className="text-muted-foreground">—</span>,
    }),
    helper.accessor((expense) => linesSummary(expense), {
      id: "what",
      header: "What",
      enableSorting: false,
      meta: { search: (expense: Expense) => expense.lines.map((line) => line.name) },
    }),
    helper.accessor((expense) => expense.files ?? 0, {
      id: "receipt",
      header: "Receipt",
      sortFn: "basic",
      meta: { search: (expense: Expense) => ((expense.files ?? 0) > 0 ? "receipt" : "no receipt") },
      cell: ({ row }) => <ExpenseReceipt expense={row.original} />,
    }),
    helper.accessor("totalCents", {
      header: "Total",
      sortFn: "basic",
      meta: { search: (expense: Expense) => formatCents(expense.totalCents) },
      cell: ({ getValue }) => <span className="tabular-nums">{formatCents(getValue())}</span>,
    }),
  ]);
}

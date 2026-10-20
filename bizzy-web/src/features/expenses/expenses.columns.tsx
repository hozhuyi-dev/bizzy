import { PaperclipIcon } from "lucide-react";
import { linesCategories, linesSummary } from "./expenses.util";
import type { LinkOptions } from "@tanstack/react-router";
import type { CatalogueView, ExpenseView } from "./expenses.types";
import { Badge } from "~/components/ui/badge";
import { CellEmpty, CellText, RowLink } from "~/components/shared/data-table/data-table-cell.component";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.config";
import { DataCard } from "~/components/shared/data-card/data-card.component";
import { formatDate } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

const helper = createDataTableColumnHelper<ExpenseView>();

/** Whether the receipt is attached: kept for the tax return. */
function ExpenseReceipt({ expense }: { expense: ExpenseView }) {
  const { files } = expense;
  if (files === 0) return <Badge variant="attention">No receipt</Badge>;
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <PaperclipIcon className="size-3.5" aria-hidden="true" />
      {files === 1 ? "Receipt" : `${files} files`}
    </span>
  );
}

function ExpenseLink({ expense }: { expense: ExpenseView }) {
  return <RowLink {...expenseLink(expense)}>{formatDate(expense.date)}</RowLink>;
}

export function expenseLink(expense: ExpenseView): LinkOptions {
  return { to: "/expenses/$id", params: { id: expense.id } };
}

/** "Supplies · bought for the clinic": the categories and the notes, under what was bought. */
function aboutText(expense: ExpenseView, catalogue: CatalogueView | undefined): string {
  return [linesCategories(expense, catalogue), expense.notes].filter(Boolean).join(" · ");
}

/** The phone layout of a row: when and where, the total, what was bought, its categories and notes. */
export function ExpenseCard({ expense, catalogue }: { expense: ExpenseView; catalogue: CatalogueView | undefined }) {
  return (
    <DataCard
      title={
        <>
          <span className="font-medium">{formatDate(expense.date)}</span>
          {expense.vendor && <span className="text-muted-foreground">{expense.vendor}</span>}
          {expense.files === 0 && <Badge variant="attention">No receipt</Badge>}
        </>
      }
      value={formatCents(expense.totalCents)}
      meta={linesSummary(expense)}
      detail={aboutText(expense, catalogue)}
      detailTitle={expense.notes}
      open={expenseLink(expense)}
    />
  );
}

/** Columns that name categories from the catalogue, as far as it is loaded. */
export function createExpenseColumns(catalogue: CatalogueView | undefined) {
  return helper.columns([
    helper.accessor("date", {
      header: "Date",
      sortFn: "basic",
      meta: { search: (expense: ExpenseView) => formatDate(expense.date) },
      cell: ({ row }) => <ExpenseLink expense={row.original} />,
    }),
    helper.accessor((expense) => expense.vendor ?? "", {
      id: "vendor",
      header: "Where",
      sortFn: "alphanumeric",
      cell: ({ getValue }) => (getValue() ? <CellText className="max-w-48">{getValue()}</CellText> : <CellEmpty />),
    }),
    helper.accessor((expense) => linesSummary(expense), {
      id: "what",
      header: "What",
      enableSorting: false,
      meta: {
        width: "grow",
        search: (expense: ExpenseView) => [
          ...expense.lines.map((line) => line.name),
          linesCategories(expense, catalogue),
          expense.notes,
        ],
      },
      cell: ({ row }) => (
        <CellText sub={aboutText(row.original, catalogue)} title={row.original.lines.map((line) => line.name).join(", ")}>
          {linesSummary(row.original)}
        </CellText>
      ),
    }),
    helper.accessor((expense) => expense.files, {
      id: "receipt",
      header: "Receipt",
      sortFn: "basic",
      meta: { search: (expense: ExpenseView) => (expense.files > 0 ? "receipt" : "no receipt") },
      cell: ({ row }) => <ExpenseReceipt expense={row.original} />,
    }),
    helper.accessor("totalCents", {
      header: "Total",
      sortFn: "basic",
      meta: { align: "end", search: (expense: ExpenseView) => formatCents(expense.totalCents) },
      cell: ({ getValue }) => formatCents(getValue()),
    }),
  ]);
}

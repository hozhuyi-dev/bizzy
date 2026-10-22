import { normalizeName } from "./expenses.util";
import type { CatalogueView, ExpenseFields, ExpenseView } from "./expenses.types";
import { centsToInput, parseCents } from "~/core/utils/money.util";
import { todayISO } from "~/core/utils/date.util";

/** One line as typed. itemId is set once the name matches an item in the list. */
export interface ExpenseLineValues {
  itemId: string;
  name: string;
  categoryId: string;
  amount: string;
}

export interface ExpenseFormValues {
  date: string;
  vendor: string;
  notes: string;
  lines: Array<ExpenseLineValues>;
}

export const EMPTY_LINE: ExpenseLineValues = { itemId: "", name: "", categoryId: "", amount: "" };

export function toExpenseValues(expense: ExpenseView | undefined): ExpenseFormValues {
  if (!expense) return { date: todayISO(), vendor: "", notes: "", lines: [{ ...EMPTY_LINE }] };
  return {
    date: expense.date,
    vendor: expense.vendor ?? "",
    notes: expense.notes ?? "",
    lines: expense.lines.map((line) => ({
      itemId: line.itemId,
      name: line.name,
      categoryId: line.categoryId,
      amount: centsToInput(line.amountCents),
    })),
  };
}

/**
 * The line once its name is typed: a listed item fills in its category and
 * what it last cost (unless an amount is typed); a new name keeps the
 * category chosen. A line already saved keeps its own category.
 */
export function withName(line: ExpenseLineValues, name: string, catalogue: CatalogueView): ExpenseLineValues {
  const item = catalogue.items.find((it) => normalizeName(it.name) === normalizeName(name));
  if (!item) return { ...line, name, itemId: "" };
  if (item.id === line.itemId) return { ...line, name };
  return {
    itemId: item.id,
    name,
    categoryId: item.categoryId,
    amount: line.amount || centsToInput(item.lastAmountCents),
  };
}

/** What the lines typed so far come to. */
export function totalOf(lines: ReadonlyArray<ExpenseLineValues>): number {
  return lines.reduce((sum, line) => sum + (parseCents(line.amount) ?? 0), 0);
}

export function toExpenseFields(values: ExpenseFormValues): ExpenseFields {
  return {
    date: values.date,
    vendor: values.vendor,
    notes: values.notes.trim(),
    lines: values.lines.map((line) => ({
      ...(line.itemId ? { itemId: line.itemId } : {}),
      name: line.name,
      categoryId: line.categoryId,
      amountCents: parseCents(line.amount) ?? 0,
    })),
  };
}

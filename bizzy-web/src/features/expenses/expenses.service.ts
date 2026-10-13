import type { Catalogue, Expense, ExpenseCategory, ExpenseItem, SaveExpenseInput } from "./expenses.types";
import { invoke } from "~/core/lambda/lambda.client";

export const ExpensesService = {
  /** Expenses dated between two days, both included. */
  list: (from: string, to: string) => invoke<Array<Expense>>("expenses.list", { from, to }),
  get: (id: string) => invoke<Expense>("expenses.get", { id }),
  catalogue: () => invoke<Catalogue>("expenses.catalogue"),
  save: (input: SaveExpenseInput) => invoke<Expense>("expenses.save", input),
  delete: (expense: Pick<Expense, "id" | "version">) =>
    invoke<null>("expenses.delete", { id: expense.id, version: expense.version }),
  saveItem: (item: ExpenseItem) => invoke<ExpenseItem>("expenses.saveItem", item),
  saveCategories: (categories: Array<ExpenseCategory>) =>
    invoke<Catalogue["categories"]>("expenses.saveCategories", { categories }),
};

import type { CatalogueView, ExpenseCategory, ExpenseFields, ExpenseItem, ExpenseView } from "./expenses.types";
import { invoke } from "~/core/lambda/lambda.client";

export const ExpensesService = {
  /** Expenses dated between two days, both included. */
  list: (from: string, to: string) => invoke<Array<ExpenseView>>("expenses.list", { from, to }),
  get: (id: string) => invoke<ExpenseView>("expenses.get", { id }),
  catalogue: () => invoke<CatalogueView>("expenses.catalogue"),
  create: (fields: ExpenseFields) => invoke<ExpenseView>("expenses.create", fields),
  /** Replaces the whole receipt. */
  update: (id: string, fields: ExpenseFields) => invoke<ExpenseView>("expenses.update", { id, ...fields }),
  delete: (id: string) => invoke<null>("expenses.delete", { id }),
  saveItem: (item: ExpenseItem) => invoke<ExpenseItem>("expenses.saveItem", item),
  saveCategories: (categories: Array<ExpenseCategory>) =>
    invoke<CatalogueView["categories"]>("expenses.saveCategories", { categories }),
};

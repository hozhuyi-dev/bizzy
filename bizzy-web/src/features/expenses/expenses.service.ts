import type {
  CatalogueView,
  ExpenseCategory,
  ExpenseFields,
  ExpenseItem,
  ExpenseView,
  ExpensesPage,
  SearchExpensesRequest,
  Vendor,
} from "./expenses.types";
import { invoke } from "~/core/lambda/lambda.client";

export const ExpensesService = {
  /** A page of the expenses found, latest first; the first page has their totals. */
  search: (request: SearchExpensesRequest) => invoke<ExpensesPage>("expenses.search", request),
  get: (id: string) => invoke<ExpenseView>("expenses.get", { id }),
  catalogue: () => invoke<CatalogueView>("expenses.catalogue"),
  create: (fields: ExpenseFields) => invoke<ExpenseView>("expenses.create", fields),
  /** Replaces the whole receipt. */
  update: (id: string, fields: ExpenseFields) => invoke<ExpenseView>("expenses.update", { id, ...fields }),
  delete: (id: string) => invoke<null>("expenses.delete", { id }),
  saveItem: (item: ExpenseItem) => invoke<ExpenseItem>("expenses.saveItem", item),
  archiveVendor: (id: string, archived: boolean) => invoke<Vendor>("expenses.archiveVendor", { id, archived }),
  saveCategories: (categories: Array<ExpenseCategory>) =>
    invoke<CatalogueView["categories"]>("expenses.saveCategories", { categories }),
};

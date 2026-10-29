import type { CATALOGUE_FACET_KEYS, EXPENSE_FACETS } from "./expenses.constant";
import type { FilterSearch, ListRequest, Page } from "~/core/list/filter.types";

// Mirrors bizzy-lambda/internal/features/expenses/api.go and expense.go.

/** The expenses list's filter, as its URL keeps it; an expense's page takes it too. */
export type ExpensesSearch = FilterSearch<(typeof EXPENSE_FACETS)[number]>;

/** The items' or shops' list filter, as its URL keeps it. */
export type CatalogueSearch = FilterSearch<(typeof CATALOGUE_FACET_KEYS)[number]>;

/** One item on a receipt, as typed: the list's item of that name changing later leaves it as it was. */
export interface ExpenseLine {
  name: string;
  categoryId: string;
  amountCents: number;
}

/** One receipt, as the app shows it; mirrors expenses.View. */
export interface ExpenseView {
  id: string;
  /** The day on the receipt, YYYY-MM-DD. */
  date: string;
  /** Where it was bought: "Shopee", a shop's name. */
  vendor?: string;
  lines: Array<ExpenseLine>;
  notes?: string;
  totalCents: number;
  /** How many files are attached: the receipt's photo or PDF. */
  files: number;
  createdAt: string;
  updatedAt: string;
}

/** What the expenses found add up to; mirrors expenses.Totals. */
export interface ExpenseTotals {
  count: number;
  /** Only their lines in the categories and of the items searched for, when it was by those. */
  spentCents: number;
}

/** A page of expenses found and, on the first page, their totals; mirrors expenses.SearchView. */
export interface ExpensesPage extends Page<ExpenseView> {
  totals?: ExpenseTotals;
}

/** expenses.search's request: an empty filter takes every value. */
export interface SearchExpensesRequest extends ListRequest {
  categoryIds: Array<string>;
  /** Shops by name, however typed. */
  vendors: Array<string>;
  /** Items by name, however typed: any of its lines. */
  items: Array<string>;
  /** Whether its receipt is kept: a file attached to it. */
  receipts: Array<"kept" | "missing">;
}

/**
 * One thing the user buys, suggested by name on a line; mirrors
 * expenses.Item. Receipts keep what was typed on them, so renaming or
 * archiving it changes only the suggestions.
 */
export interface ExpenseItem {
  id: string;
  name: string;
  /** The category a new line of it starts in: the last one's. */
  categoryId: string;
  /** Not suggested any more. */
  archived?: boolean;
  /** What it cost the last time, to prefill a new line. */
  lastAmountCents?: number;
}

/** Groups items the way LHDN's Form B does. */
export interface ExpenseCategory {
  /** Absent on one just added. */
  id?: string;
  name: string;
  /** What goes in it. */
  hint?: string;
  /** Equipment that lasts: claimed through capital allowances. */
  capital?: boolean;
  archived?: boolean;
}

/**
 * Somewhere the user buys from, suggested on the next receipt; mirrors
 * expenses.Vendor. Receipts name it as text, so renaming or archiving it
 * changes only the suggestions.
 */
export interface Vendor {
  id: string;
  name: string;
  /** The latest receipt's day, YYYY-MM-DD. */
  lastUsed: string;
  archived?: boolean;
}

/** What the expense form suggests; mirrors expenses.CatalogueView. Vendors come last used first. */
export interface CatalogueView {
  categories: Array<ExpenseCategory & { id: string }>;
  items: Array<ExpenseItem>;
  vendors: Array<Vendor>;
}

/**
 * What expenses.create and expenses.update take: the whole receipt; mirrors
 * expenses.Receipt. A line's name new to the list is added to it.
 */
export interface ExpenseFields {
  date: string;
  vendor: string;
  notes: string;
  lines: Array<ExpenseLine>;
}

/** One category's total over a period. */
export interface CategoryTotal {
  category: ExpenseCategory & { id: string };
  cents: number;
}

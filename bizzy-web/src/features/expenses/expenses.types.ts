// Mirrors bizzy-lambda/internal/features/expenses.

/** One item on a receipt. Name and category are the item's as the line was written. */
export interface ExpenseLine {
  itemId: string;
  name: string;
  categoryId: string;
  amountCents: number;
}

/** One receipt. */
export interface Expense {
  id: string;
  /** The day on the receipt, YYYY-MM-DD. */
  date: string;
  /** Where it was bought: "Shopee", a shop's name. */
  vendor?: string;
  lines: Array<ExpenseLine>;
  notes?: string;
  /** How many files are attached: the receipt's photo or PDF. */
  files?: number;
  createdAt: string;
  updatedAt: string;
  version: number;
  totalCents: number;
}

/** One thing she buys, from the list lines are picked from. */
export interface ExpenseItem {
  id: string;
  name: string;
  categoryId: string;
  /** Hidden from the list she picks from; lines keep it. */
  archived?: boolean;
  /** What it cost the last time, to prefill a new line. */
  lastAmountCents?: number;
}

/** Groups items the way LHDN's Form B does. */
export interface ExpenseCategory {
  /** Absent on one she has just added. */
  id?: string;
  name: string;
  /** What goes in it. */
  hint?: string;
  /** Equipment that lasts: claimed through capital allowances. */
  capital?: boolean;
  archived?: boolean;
}

export interface Catalogue {
  categories: Array<ExpenseCategory & { id: string }>;
  items: Array<ExpenseItem>;
}

/** An expense as the form sends it; a line without an item id adds a new item. */
export interface SaveExpenseInput {
  id?: string;
  version: number;
  date: string;
  vendor: string;
  notes: string;
  lines: Array<Omit<ExpenseLine, "itemId"> & { itemId?: string }>;
}

/** One category's total over a period. */
export interface CategoryTotal {
  category: ExpenseCategory & { id: string };
  cents: number;
}

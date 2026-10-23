import { useMemo } from "react";
import { ExpensesQuery } from "./expenses.query";
import { expenseFacets, expensePlace } from "./expenses.util";
import type { ExpenseView } from "./expenses.types";
import type { FilteredPagerList } from "~/core/list/pager.types";
import { usePagesWindow } from "~/core/list/pager.hook";

/** The expenses list, for an expense's page to step through. */
export const EXPENSES_LIST: FilteredPagerList<ExpenseView> = {
  noun: "expense",
  nouns: "expenses",
  label: "Search expenses",
  dates: true,
  useWindow: (filter) => usePagesWindow(ExpensesQuery.useSearch(filter)),
  useFacets: () => {
    const catalogue = ExpensesQuery.useCatalogue();
    return useMemo(() => expenseFacets(catalogue.data), [catalogue.data]);
  },
  idOf: (expense) => expense.id,
  placeOf: expensePlace,
};

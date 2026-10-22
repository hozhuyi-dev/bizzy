import { useQuery } from "@tanstack/react-query";
import { ExpensesService } from "./expenses.service";
import { searchExpensesRequest } from "./expenses.util";
import type { ListFilter } from "~/core/list/filter.types";
import { CatalogueKeys, ExpenseKeys } from "~/core/constants/query-keys.constant";
import { usePages } from "~/core/list/pages.hook";

export const ExpensesQuery = {
  /** The expenses a filter finds, latest first, a page at a time; the first page has their totals. */
  useSearch: (filter: ListFilter) => {
    const request = searchExpensesRequest(filter);
    return usePages(ExpenseKeys.search(request), (after) => ExpensesService.search({ ...request, after }));
  },

  /** One expense; none for a new one. */
  useDetail: (id: string | undefined) =>
    useQuery({
      queryKey: ExpenseKeys.detail(id ?? ""),
      queryFn: () => ExpensesService.get(id ?? ""),
      enabled: id !== undefined,
    }),

  /**
   * The categories, items and vendors the form suggests. Only the app
   * changes them, and every change says so (CHANGED_KEYS), so it is read
   * once and kept until one does.
   */
  useCatalogue: () =>
    useQuery({
      queryKey: CatalogueKeys.all,
      queryFn: () => ExpensesService.catalogue(),
      staleTime: Infinity,
      gcTime: Infinity,
    }),
};

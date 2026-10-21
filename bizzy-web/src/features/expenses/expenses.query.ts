import { useQuery } from "@tanstack/react-query";
import { ExpensesService } from "./expenses.service";
import { searchExpensesRequest, yearRange } from "./expenses.util";
import type { ListFilter } from "~/core/list/filter.types";
import { ExpenseKeys } from "~/core/constants/query-keys.constant";
import { usePages } from "~/core/list/filter.hook";

export const ExpensesQuery = {
  /** One calendar year's expenses, oldest first. */
  useYear: (year: number) => {
    const { from, to } = yearRange(year);
    return useQuery({
      queryKey: ExpenseKeys.list(from, to),
      queryFn: () => ExpensesService.list(from, to),
    });
  },

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

  /** The categories and items lines are picked from. */
  useCatalogue: () =>
    useQuery({
      queryKey: ExpenseKeys.catalogue(),
      queryFn: () => ExpensesService.catalogue(),
    }),
};

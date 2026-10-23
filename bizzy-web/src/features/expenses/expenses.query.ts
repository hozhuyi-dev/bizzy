import { queryOptions, useQuery } from "@tanstack/react-query";
import { ExpensesService } from "./expenses.service";
import { searchExpensesRequest } from "./expenses.util";
import type { ListFilter } from "~/core/list/filter.types";
import { CatalogueKeys, ExpenseKeys } from "~/core/constants/query-keys.constant";
import { usePages } from "~/core/list/pages.hook";

const detail = (id: string) => queryOptions({ queryKey: ExpenseKeys.detail(id), queryFn: () => ExpensesService.get(id) });

/**
 * The categories, items and vendors the form suggests. Only the app
 * changes them, and every change says so (CHANGED_KEYS), so it is read
 * once and kept until one does.
 */
const catalogue = () =>
  queryOptions({
    queryKey: CatalogueKeys.all,
    queryFn: () => ExpensesService.catalogue(),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const ExpensesQuery = {
  /** For a route's loader (see pageData). */
  detail,
  catalogue,

  /** The expenses a filter finds, latest first, a page at a time; the first page has their totals. */
  useSearch: (filter: ListFilter) => {
    const request = searchExpensesRequest(filter);
    return usePages(ExpenseKeys.search(request), (after) => ExpensesService.search({ ...request, after }));
  },

  /** One expense; none for a new one. */
  useDetail: (id: string | undefined) =>
    useQuery({ ...detail(id ?? ""), enabled: id !== undefined }),

  useCatalogue: () => useQuery(catalogue()),
};

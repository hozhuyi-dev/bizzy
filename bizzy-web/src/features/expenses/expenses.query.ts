import { useQuery } from "@tanstack/react-query";
import { ExpensesService } from "./expenses.service";
import { yearRange } from "./expenses.util";
import { ExpenseKeys } from "~/core/constants/query-keys.constant";

export const ExpensesQuery = {
  /** One calendar year's expenses, oldest first. */
  useYear: (year: number) => {
    const { from, to } = yearRange(year);
    return useQuery({
      queryKey: ExpenseKeys.list(from, to),
      queryFn: () => ExpensesService.list(from, to),
    });
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

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExpensesService } from "./expenses.service";
import type { Expense, ExpenseCategory, ExpenseItem, SaveExpenseInput } from "./expenses.types";
import { ExpenseKeys } from "~/core/constants/query-keys.constant";
import { isStaleEdit } from "~/core/utils/api-error.util";

/** Every expense write can touch the lists, the expense and the catalogue (new items, last amounts). */
function useExpenseMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ExpenseKeys.all });
  return useMutation({
    mutationFn,
    onSuccess: refresh,
    // Changed in another tab: show the latest before she tries again.
    onError: (error) => {
      if (isStaleEdit(error)) void refresh();
    },
  });
}

export const ExpensesMutation = {
  useSave: () => useExpenseMutation((input: SaveExpenseInput) => ExpensesService.save(input)),
  useDelete: () => useExpenseMutation((expense: Pick<Expense, "id" | "version">) => ExpensesService.delete(expense)),
  useSaveItem: () => useExpenseMutation((item: ExpenseItem) => ExpensesService.saveItem(item)),
  useSaveCategories: () =>
    useExpenseMutation((categories: Array<ExpenseCategory>) => ExpensesService.saveCategories(categories)),
};

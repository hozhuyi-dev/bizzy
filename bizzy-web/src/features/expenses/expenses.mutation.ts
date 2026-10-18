import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExpensesService } from "./expenses.service";
import type { ExpenseCategory, ExpenseFields, ExpenseItem } from "./expenses.types";
import { ExpenseKeys } from "~/core/constants/query-keys.constant";
import { isStaleEdit } from "~/core/utils/api-error.util";

/** Every expense write can touch the lists, the expense and the catalogue (new items, last amounts). */
function useExpenseMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ExpenseKeys.all });
  return useMutation({
    mutationFn,
    onSuccess: refresh,
    // Changed at the same moment, or gone: show the latest before the user tries again.
    onError: (error) => {
      if (isStaleEdit(error)) void refresh();
    },
  });
}

export const ExpensesMutation = {
  useCreate: () => useExpenseMutation((fields: ExpenseFields) => ExpensesService.create(fields)),
  /** Replaces the whole receipt. */
  useUpdate: () =>
    useExpenseMutation(({ id, fields }: { id: string; fields: ExpenseFields }) => ExpensesService.update(id, fields)),
  useDelete: () => useExpenseMutation((id: string) => ExpensesService.delete(id)),
  useSaveItem: () => useExpenseMutation((item: ExpenseItem) => ExpensesService.saveItem(item)),
  useSaveCategories: () =>
    useExpenseMutation((categories: Array<ExpenseCategory>) => ExpensesService.saveCategories(categories)),
};

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExpensesService } from "./expenses.service";
import type { ExpenseCategory, ExpenseFields, ExpenseItem } from "./expenses.types";
import { CatalogueKeys, ExpenseKeys } from "~/core/constants/query-keys.constant";
import { isStaleEdit } from "~/core/utils/api-error.util";

/** What a write changes is read again as the API says (refreshChanged). */
function useExpenseMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ExpenseKeys.all }),
      queryClient.invalidateQueries({ queryKey: CatalogueKeys.all }),
    ]);
  return useMutation({
    mutationFn,
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
  useArchiveVendor: () =>
    useExpenseMutation(({ id, archived }: { id: string; archived: boolean }) => ExpensesService.archiveVendor(id, archived)),
  useSaveCategories: () =>
    useExpenseMutation((categories: Array<ExpenseCategory>) => ExpensesService.saveCategories(categories)),
};

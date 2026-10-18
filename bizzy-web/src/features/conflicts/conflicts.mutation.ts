import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConflictsService } from "./conflicts.service";
import { invalidateBilling } from "~/core/utils/query.util";

/** Settling an edit changes sessions, packages and documents: everything billing is refreshed. */
function useConflictMutation(fn: (eventId: string) => Promise<null>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => invalidateBilling(queryClient) });
}

export const ConflictsMutation = {
  useRevert: () => useConflictMutation(ConflictsService.revert),
  useApply: () => useConflictMutation(ConflictsService.apply),
};

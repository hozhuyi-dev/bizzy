import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FollowUpsService } from "./follow-ups.service";
import type { FollowUpDraft } from "./follow-ups.types";
import { FollowUpKeys, TodoKeys } from "~/core/constants/query-keys.constant";

/** A follow-up changes the to-do list and every follow-up list. */
function useFollowUpMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: FollowUpKeys.all }),
        queryClient.invalidateQueries({ queryKey: TodoKeys.all }),
      ]),
  });
}

export const FollowUpsMutation = {
  useCreate: () => useFollowUpMutation((draft: FollowUpDraft) => FollowUpsService.create(draft)),
  useUpdate: () =>
    useFollowUpMutation(({ id, draft }: { id: string; draft: FollowUpDraft }) => FollowUpsService.update(id, draft)),
  useDelete: () => useFollowUpMutation((id: string) => FollowUpsService.delete(id)),
  useSetDone: () =>
    useFollowUpMutation(({ id, done }: { id: string; done: boolean }) => FollowUpsService.setDone(id, done)),
};

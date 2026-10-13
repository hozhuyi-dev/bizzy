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
    useFollowUpMutation(({ eventId, draft }: { eventId: string; draft: FollowUpDraft }) =>
      FollowUpsService.update(eventId, draft),
    ),
  useDelete: () => useFollowUpMutation((eventId: string) => FollowUpsService.delete(eventId)),
  useSetDone: () =>
    useFollowUpMutation(({ eventId, done }: { eventId: string; done: boolean }) =>
      FollowUpsService.setDone(eventId, done),
    ),
};

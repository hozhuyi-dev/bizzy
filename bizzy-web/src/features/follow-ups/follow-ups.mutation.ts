import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FollowUpsService } from "./follow-ups.service";
import type { CreateFollowUpRequest, FollowUpFields } from "./follow-ups.types";
import { ActivityKeys, FollowUpKeys, TimelineKeys, TodoKeys } from "~/core/constants/query-keys.constant";

/** A follow-up changes the to-do list, every follow-up list, and where its client stands. */
function useFollowUpMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: FollowUpKeys.all }),
        queryClient.invalidateQueries({ queryKey: TodoKeys.all }),
        queryClient.invalidateQueries({ queryKey: ActivityKeys.all }),
        queryClient.invalidateQueries({ queryKey: TimelineKeys.all }),
      ]),
  });
}

export const FollowUpsMutation = {
  useCreate: () => useFollowUpMutation((request: CreateFollowUpRequest) => FollowUpsService.create(request)),
  /** A patch: only what is set changes. */
  useUpdate: () =>
    useFollowUpMutation(({ id, fields }: { id: string; fields: FollowUpFields }) => FollowUpsService.update(id, fields)),
  useDelete: () => useFollowUpMutation((id: string) => FollowUpsService.delete(id)),
  /** Records getting back to a client today: a follow-up done already. Deleting it undoes it. */
  useReachedOut: () => useFollowUpMutation((clientId: string) => FollowUpsService.reachedOut(clientId)),
  useSetDone: () =>
    useFollowUpMutation(({ id, done }: { id: string; done: boolean }) => FollowUpsService.setDone(id, done)),
};

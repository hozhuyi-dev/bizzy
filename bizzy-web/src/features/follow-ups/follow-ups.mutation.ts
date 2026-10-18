import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FollowUpsService } from "./follow-ups.service";
import type { CreateFollowUpRequest, FollowUpFields } from "./follow-ups.types";
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
  useCreate: () => useFollowUpMutation((request: CreateFollowUpRequest) => FollowUpsService.create(request)),
  /** A patch: only what is set changes. */
  useUpdate: () =>
    useFollowUpMutation(({ id, fields }: { id: string; fields: FollowUpFields }) => FollowUpsService.update(id, fields)),
  useDelete: () => useFollowUpMutation((id: string) => FollowUpsService.delete(id)),
  useSetDone: () =>
    useFollowUpMutation(({ id, done }: { id: string; done: boolean }) => FollowUpsService.setDone(id, done)),
};

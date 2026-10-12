import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FollowUpsService } from "./follow-ups.service";
import type { FollowUp, FollowUpDraft, FollowUpView } from "./follow-ups.types";
import { FollowUpKeys, TodoKeys } from "~/core/keys.query";

export const FollowUpsQuery = {
  /** A page at a time; "Load more" reads the next. */
  useList: (view: FollowUpView) =>
    useInfiniteQuery({
      queryKey: FollowUpKeys.list(view),
      queryFn: ({ pageParam }) => FollowUpsService.list(view, pageParam),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page) => page.next,
    }),

  useByClient: (clientId: string) =>
    useInfiniteQuery({
      queryKey: FollowUpKeys.client(clientId),
      queryFn: ({ pageParam }) => FollowUpsService.listByClient(clientId, pageParam),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page) => page.next,
    }),

  useBySession: (sessionId: string) =>
    useQuery({
      queryKey: FollowUpKeys.session(sessionId),
      queryFn: () => FollowUpsService.listBySession(sessionId),
    }),
};

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

/** Marks a follow-up done with an Undo in the toast. */
export function useMarkDone() {
  const { mutate, isPending } = FollowUpsMutation.useSetDone();
  const mark = (followUp: FollowUp, done = true) =>
    mutate(
      { eventId: followUp.eventId, done },
      {
        onSuccess: () => {
          if (!done) return;
          toast.success("Follow-up done", {
            action: { label: "Undo", onClick: () => mutate({ eventId: followUp.eventId, done: false }) },
          });
        },
        onError: (error) => toast.error(error.message),
      },
    );
  return { mark, isPending };
}

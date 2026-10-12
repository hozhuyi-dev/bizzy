import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SessionsService } from "./sessions.service";
import type { SessionDraft } from "./sessions.types";
import { ApiError } from "~/core/lambda/lambda.client";
import { SessionKeys } from "~/core/keys.query";
import { invalidateBilling } from "~/core/utils/query.util";

/**
 * The calendar changed since she looked (or the event is gone). The API has
 * stored the latest, so the app reloads to show it before she tries again.
 */
export function isStaleEdit(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.code === "conflict" || error.code === "not_found");
}

/**
 * Refreshes billing after a write, except the session's own page, which she
 * is leaving. A stale edit refreshes everything, that page included.
 */
function useSessionMutation<TInput>(
  mutationFn: (input: TInput) => Promise<unknown>,
  eventIdOf: (input: TInput) => string | undefined = () => undefined,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (_data, input) => {
      const eventId = eventIdOf(input);
      void invalidateBilling(queryClient, eventId ? SessionKeys.detail(eventId) : undefined);
    },
    onError: (error) => {
      if (isStaleEdit(error)) void invalidateBilling(queryClient);
    },
  });
}

export const SessionsMutation = {
  useCreate: () => useSessionMutation((draft: SessionDraft) => SessionsService.create(draft)),

  useUpdate: () =>
    useSessionMutation(
      ({ eventId, draft }: { eventId: string; draft: SessionDraft }) => SessionsService.update(eventId, draft),
      ({ eventId }) => eventId,
    ),

  /** Removes the `?`, keeping the rest of the title. */
  useConfirm: () =>
    useSessionMutation(async (eventId: string) => {
      const { draft } = await SessionsService.get(eventId);
      return SessionsService.update(eventId, { ...draft, tentative: false });
    }),

  useDelete: () =>
    useSessionMutation(
      (eventId: string) => SessionsService.delete(eventId),
      (eventId) => eventId,
    ),
};

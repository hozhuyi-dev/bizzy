import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SessionsService } from "./sessions.service";
import type { PaymentInput, SessionDraft } from "./sessions.types";
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
 * Refreshes billing after a write. The session's own page is left alone
 * unless asked (`refresh`): its forms restart on a refetch, which would lose
 * what she is typing. A stale edit refreshes everything, that page included.
 */
function useSessionMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  eventIdOf: (input: TInput) => string | undefined = () => undefined,
  refresh = false,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (_data, input) => {
      const eventId = eventIdOf(input);
      void invalidateBilling(queryClient, eventId && !refresh ? SessionKeys.detail(eventId) : undefined);
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
      true,
    ),

  /** Removes the `?`, keeping the rest of the title. */
  useConfirm: () =>
    useSessionMutation(
      async (eventId: string) => {
        const { draft } = await SessionsService.get(eventId);
        return SessionsService.update(eventId, { ...draft, tentative: false });
      },
      (eventId) => eventId,
      true,
    ),

  /** Deletes the event and the session, with anything recorded on it. */
  useDelete: () =>
    useSessionMutation(
      (eventId: string) => SessionsService.delete(eventId),
      (eventId) => eventId,
    ),

  /** Brings back a session deleted in the calendar. */
  useRestore: () =>
    useSessionMutation(
      (eventId: string) => SessionsService.restore(eventId),
      (eventId) => eventId,
      true,
    ),

  /** Drops a session deleted in the calendar, with what she recorded. */
  useDiscard: () =>
    useSessionMutation(
      (eventId: string) => SessionsService.discard(eventId),
      (eventId) => eventId,
    ),

  /** Saves the summary and notes; the page keeps what she is typing. */
  useSaveRecord: () =>
    useSessionMutation(
      ({ eventId, summary, notes }: { eventId: string; summary: string; notes: string }) =>
        SessionsService.saveRecord(eventId, summary, notes),
      ({ eventId }) => eventId,
    ),

  useSetPayment: () =>
    useSessionMutation(
      ({ eventId, payment }: { eventId: string; payment: PaymentInput | null }) =>
        SessionsService.setPayment(eventId, payment),
      ({ eventId }) => eventId,
      true,
    ),
};

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SessionsService } from "./sessions.service";
import type { BookingOptions, PackageChoice, SessionDraft } from "./sessions.types";
import { SessionKeys } from "~/core/constants/query-keys.constant";
import { isStaleEdit } from "~/core/utils/api-error.util";
import { invalidateBilling } from "~/core/utils/query.util";

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
  // Saving a booking goes through its preview: see useBookingSave.
  useCreate: () =>
    useSessionMutation(({ draft, options }: { draft: SessionDraft; options?: BookingOptions }) =>
      SessionsService.create(draft, options),
    ),

  useUpdate: () =>
    useSessionMutation(
      ({ eventId, draft, options }: { eventId: string; draft: SessionDraft; options?: BookingOptions }) =>
        SessionsService.update(eventId, draft, options),
      ({ eventId }) => eventId,
      true,
    ),

  /** Deletes the event and the session, with anything recorded on it, and keeps or deletes the package it bought. */
  useDelete: () =>
    useSessionMutation(
      ({ eventId, pkg, confirm }: { eventId: string; pkg: PackageChoice; confirm: boolean }) =>
        SessionsService.delete(eventId, pkg, confirm),
      ({ eventId }) => eventId,
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

  /** Saves the summary alone, from the to-do list; the notes are kept. */
  useSaveSummary: () =>
    useSessionMutation(
      ({ eventId, summary }: { eventId: string; summary: string }) => SessionsService.saveRecord(eventId, summary),
      ({ eventId }) => eventId,
      true,
    ),
};

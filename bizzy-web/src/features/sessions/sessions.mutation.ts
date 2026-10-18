import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SessionsService } from "./sessions.service";
import type { SessionFields } from "./sessions.types";
import { SessionKeys } from "~/core/constants/query-keys.constant";
import { isStaleEdit } from "~/core/utils/api-error.util";
import { invalidateBilling } from "~/core/utils/query.util";

/**
 * Refreshes billing after a write. The session's own page is left alone
 * unless asked (`refresh`): its forms restart on a refetch, which would lose
 * what the user is typing. A stale edit refreshes everything, that page
 * included.
 */
function useSessionMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  idOf: (input: TInput) => string | undefined = () => undefined,
  refresh = false,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (_data, input) => {
      const id = idOf(input);
      void invalidateBilling(queryClient, id && !refresh ? SessionKeys.detail(id) : undefined);
    },
    onError: (error) => {
      if (isStaleEdit(error)) void invalidateBilling(queryClient);
    },
  });
}

export const SessionsMutation = {
  useCreate: () => useSessionMutation((fields: SessionFields) => SessionsService.create(fields)),

  /** A patch: only what is set changes. */
  useUpdate: () =>
    useSessionMutation(
      ({ id, fields }: { id: string; fields: SessionFields }) => SessionsService.update(id, fields),
      ({ id }) => id,
      true,
    ),

  /** Deletes the session with anything recorded on it, and its event; keeps or deletes the package it bought. */
  useDelete: () =>
    useSessionMutation(
      ({ id, keepPackage }: { id: string; keepPackage: boolean }) => SessionsService.delete(id, keepPackage),
      ({ id }) => id,
    ),

  /** Saves the summary and notes; the page keeps what the user is typing. */
  useSaveRecord: () =>
    useSessionMutation(
      ({ id, summary, notes }: { id: string; summary: string; notes: string }) =>
        SessionsService.saveRecord(id, summary, notes),
      ({ id }) => id,
    ),

  /** Saves the summary alone, from the to-do list; the notes are kept. */
  useSaveSummary: () =>
    useSessionMutation(
      ({ id, summary }: { id: string; summary: string }) => SessionsService.saveRecord(id, summary),
      ({ id }) => id,
      true,
    ),
};

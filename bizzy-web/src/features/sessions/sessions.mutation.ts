import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SessionsService } from "./sessions.service";
import type { SessionFields, SessionView } from "./sessions.types";
import type { TodoView } from "~/features/todo/todo.types";
import { SessionKeys, TodoKeys } from "~/core/constants/query-keys.constant";
import { isStaleEdit } from "~/core/utils/api-error.util";
import { invalidateBilling } from "~/core/utils/query.util";
import { withSession } from "~/features/todo/todo.util";

interface SessionMutationOptions<TInput> {
  /** The session it writes, whose page is left alone unless `refresh`. */
  idOf?: (input: TInput) => string | undefined;
  refresh?: boolean;
}

/**
 * Refreshes billing after a write. The session's own page is left alone
 * unless asked (`refresh`): its forms restart on a refetch, which would lose
 * what the user is typing. A stale edit refreshes everything, that page
 * included. An action that returns the session puts it on the to-do list
 * at once, so its row shows what was just done instead of waiting for the
 * refetch.
 */
function useSessionMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  { idOf = () => undefined, refresh = false }: SessionMutationOptions<TInput> = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data, input) => {
      if (isSessionView(data)) {
        queryClient.setQueryData<Array<TodoView>>(TodoKeys.list(), (items) => items && withSession(items, data));
      }
      const id = idOf(input);
      void invalidateBilling(queryClient, id && !refresh ? SessionKeys.detail(id) : undefined);
    },
    onError: (error) => {
      if (isStaleEdit(error)) void invalidateBilling(queryClient);
    },
  });
}

function isSessionView(data: unknown): data is SessionView {
  return typeof data === "object" && data !== null && "id" in data && "todo" in data;
}

export const SessionsMutation = {
  useCreate: () => useSessionMutation((fields: SessionFields) => SessionsService.create(fields)),

  /** A patch: only what is set changes. */
  useUpdate: () =>
    useSessionMutation(({ id, fields }: { id: string; fields: SessionFields }) => SessionsService.update(id, fields), {
      idOf: ({ id }) => id,
      refresh: true,
    }),

  /** Deletes the session with anything recorded on it, and its event; keeps or deletes the package it bought. */
  useDelete: () =>
    useSessionMutation(
      ({ id, keepPackage }: { id: string; keepPackage: boolean }) => SessionsService.delete(id, keepPackage),
      { idOf: ({ id }) => id },
    ),

  /** Saves the summary and notes; the page keeps what the user is typing. */
  useSaveRecord: () =>
    useSessionMutation(
      ({ id, summary, notes }: { id: string; summary: string; notes: string }) =>
        SessionsService.saveRecord(id, summary, notes),
      { idOf: ({ id }) => id },
    ),

  /** Saves the summary alone, from the to-do list; the notes are kept. */
  useSaveSummary: () =>
    useSessionMutation(({ id, summary }: { id: string; summary: string }) => SessionsService.saveRecord(id, summary), {
      idOf: ({ id }) => id,
      refresh: true,
    }),
};

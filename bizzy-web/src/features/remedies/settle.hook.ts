import { useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { QueryClient } from "@tanstack/react-query";
import type { ConflictView } from "~/features/conflicts/conflicts.types";
import type { TodoView } from "~/features/todo/todo.types";
import { TodoQuery } from "~/features/todo/todo.query";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";

/** The calendar edits waiting on the to-do list, by event. */
export function waitingIn(items: ReadonlyArray<TodoView> | undefined): Map<string, ConflictView> {
  return new Map((items ?? []).flatMap((item) => (item.kind === "conflict" ? [[item.conflict.eventId, item.conflict]] : [])));
}

/** The calendar edits the to-do list showed last, before a fix is taken. */
export function waitingBefore(queryClient: QueryClient): Set<string> {
  return new Set(waitingIn(queryClient.getQueryData(TodoQuery.list().queryKey)).keys());
}

/**
 * After a fix for a calendar edit: the API tries the waiting edits again
 * once the app changes what refused them, so the to-do list is read again
 * to say, in one toast, what was done and whether the edit went in (with
 * any others the fix let through), or why it still can't.
 */
export async function reportSettled(
  queryClient: QueryClient,
  eventId: string,
  before: ReadonlySet<string>,
  done: string,
  quip: boolean,
): Promise<void> {
  const after = waitingIn(await queryClient.fetchQuery({ ...TodoQuery.list(), staleTime: 0 }));
  const still = after.get(eventId);
  if (still) {
    toast.warning(`${done}, but “${still.title}” still can't go in`, { description: still.message });
    return;
  }
  const settled = Math.max([...before].filter((id) => !after.has(id)).length, 1);
  const message = `${done} · ${settled === 1 ? "the calendar edit is in" : `${settled} calendar edits are in`}`;
  if (quip) toastWithQuip(message, QUIPS.todoDone);
  else toast.success(message);
}

/**
 * For a page a fix opened to settle a calendar edit (a remedy's second
 * step, with the edit's event as `settle` in history: see HistoryState).
 * Once the page has saved, it goes back to the to-do list with one toast
 * for both: what was saved, and whether the edit went in. Undefined when
 * the page wasn't opened for one: it then says and goes on as it would.
 */
export function useSettleReturn(): ((done: string) => void) | undefined {
  const settle = useLocation({ select: (location) => location.state.settle });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // As the list was when the page opened: saving refreshes it.
  const [before] = useState(() => waitingBefore(queryClient));
  if (!settle) return undefined;
  return (done) => {
    void navigate({ to: "/", ignoreBlocker: true });
    void reportSettled(queryClient, settle, before, done, true);
  };
}

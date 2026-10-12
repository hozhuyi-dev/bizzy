import { useQuery } from "@tanstack/react-query";
import type { TodoItem } from "./todo.types";
import { invoke } from "~/core/lambda/lambda.client";
import { TodoKeys } from "~/core/keys.query";

export const TodoService = {
  list: () => invoke<Array<TodoItem>>("todo.list"),
};

export const TodoQuery = {
  /** Everything that needs her, oldest first. */
  useList: () =>
    useQuery({
      queryKey: TodoKeys.list(),
      queryFn: () => TodoService.list(),
    }),
};

/**
 * The session to open after this one: the next session on the to-do list,
 * wrapping round, so she can work through it in one go.
 */
export function nextTodoSession(items: ReadonlyArray<TodoItem> | undefined, current: string): string | undefined {
  const sessions = (items ?? []).flatMap((item) => (item.kind === "session" ? [item.session.eventId] : []));
  const others = sessions.filter((id) => id !== current);
  if (others.length === 0) return undefined;
  const at = sessions.indexOf(current);
  if (at < 0) return others[0];
  return sessions.slice(at + 1).find((id) => id !== current) ?? others[0];
}

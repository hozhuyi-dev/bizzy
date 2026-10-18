import type { TodoFilter, TodoGroup, TodoView } from "./todo.types";
import { addDays, startOfDay } from "~/core/utils/date.util";

export function matchesFilter(item: TodoView, filter: TodoFilter | undefined): boolean {
  if (!filter) return true;
  switch (item.kind) {
    case "followUp":
      return filter === "followUp";
    case "conflict":
      return filter === "fix";
    case "package":
      return filter === "collect";
    case "session":
      return item.session.todo.some((reason) => reason === filter);
  }
}

/** Which day group an item falls in, in the user's time zone. */
export function groupOf(item: TodoView, now = new Date()): TodoGroup {
  const at = new Date(item.at);
  const startOfToday = startOfDay(now);
  if (at < startOfToday) return "overdue";
  if (at < addDays(startOfToday, 1)) return "today";
  return "upcoming";
}

/** A stable key for an item. */
export function todoKey(item: TodoView): string {
  switch (item.kind) {
    case "session":
      return `s:${item.session.id}`;
    case "package":
      return `p:${item.package.id}`;
    case "followUp":
      return `f:${item.followUp.id}`;
    case "conflict":
      return `c:${item.conflict.eventId}`;
  }
}

/**
 * The session to open after this one: the next session on the to-do list,
 * wrapping round, so the user can work through it in one go.
 */
export function nextTodoSession(items: ReadonlyArray<TodoView> | undefined, current: string): string | undefined {
  const sessions = (items ?? []).flatMap((item) => (item.kind === "session" ? [item.session.id] : []));
  const others = sessions.filter((id) => id !== current);
  if (others.length === 0) return undefined;
  const at = sessions.indexOf(current);
  if (at < 0) return others[0];
  return sessions.slice(at + 1).find((id) => id !== current) ?? others[0];
}

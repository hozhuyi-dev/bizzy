import type { TodoFilter, TodoGroup, TodoView } from "./todo.types";
import type { SessionView } from "~/features/sessions/sessions.types";
import { addDays, startOfDay } from "~/core/utils/date.util";

export function matchesFilter(item: TodoView, filter: TodoFilter | undefined): boolean {
  if (!filter) return true;
  switch (item.kind) {
    case "followUp":
      return filter === "followUp";
    case "conflict":
      return filter === "calendar";
    case "package":
      return filter === "collect";
    case "session":
      return item.session.todo.some((reason) => reason === filter);
  }
}

/**
 * Which group an item falls in: a calendar edit its own, the rest by day
 * in the user's time zone.
 */
export function groupOf(item: TodoView, now = new Date()): TodoGroup {
  if (item.kind === "conflict") return "calendar";
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
 * The sessions on the list, in its order, each once: what a session opened
 * from Home steps through, so the user can work through it in one go.
 */
export function todoSessionIds(items: ReadonlyArray<TodoView>): Array<string> {
  return [...new Set(items.flatMap((item) => (item.kind === "session" ? [item.session.id] : [])))];
}

/** The list's order, as the API sends it: oldest first, then by kind. */
export function byTodoOrder(a: TodoView, b: TodoView): number {
  return new Date(a.at).getTime() - new Date(b.at).getTime() || a.kind.localeCompare(b.kind);
}

/**
 * How far through the list the user is today: everything seen on it since
 * the app opened today, and how much of that is gone. Kept outside the
 * page, so a trip to another page and back (a fix in two steps) keeps the
 * count; it starts again the next day.
 */
const progress = { day: "", seen: new Set<string>() };

export function progressOf(items: ReadonlyArray<TodoView>, day: string): { cleared: number; left: number } {
  if (progress.day !== day) {
    progress.day = day;
    progress.seen = new Set();
  }
  const now = new Set(items.map(todoKey));
  for (const key of now) progress.seen.add(key);
  let cleared = 0;
  for (const key of progress.seen) if (!now.has(key)) cleared++;
  return { cleared, left: now.size };
}

/**
 * The list with a session as an action just left it: its row as it is
 * now, or gone once nothing is left to do on it. A session not on the list
 * is left to the refetch, which knows whether it now belongs.
 */
export function withSession(items: ReadonlyArray<TodoView>, session: SessionView): Array<TodoView> {
  return items.flatMap((item) => {
    if (item.kind !== "session" || item.session.id !== session.id) return [item];
    return session.todo.length > 0 ? [{ ...item, session }] : [];
  });
}

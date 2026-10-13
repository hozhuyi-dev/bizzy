import type { FollowUp } from "~/features/follow-ups/follow-ups.types";
import type { Package } from "~/features/packages/packages.types";
import type { Session, TodoReason } from "~/features/sessions/sessions.types";

/**
 * One thing on her to-do list; mirrors bizzy-lambda/internal/features/todo.
 * A package is its own item only when no session bought it (added here, or
 * unlinked); one bought in a session is collected on that session. A
 * follow-up has a reason only to fix it: its title can't be read or matched.
 */
export type TodoItem =
  | { kind: "session"; at: string; reasons: Array<TodoReason>; session: Session }
  | { kind: "package"; at: string; reasons: Array<TodoReason>; package: Package }
  | { kind: "followUp"; at: string; reasons?: Array<"fix">; followUp: FollowUp };

/** The filter chips: a session reason, or follow-ups (one to fix is under Fix too). */
export type TodoFilter = TodoReason | "followUp";

export const TODO_FILTERS: ReadonlyArray<{ value: TodoFilter; label: string }> = [
  { value: "confirm", label: "Confirm" },
  { value: "record", label: "Record" },
  { value: "collect", label: "Collect" },
  { value: "followUp", label: "Follow up" },
  { value: "fix", label: "Fix" },
  { value: "deleted", label: "Deleted" },
];

export function matchesFilter(item: TodoItem, filter: TodoFilter | undefined): boolean {
  if (!filter) return true;
  if (item.kind === "followUp") return filter === "followUp" || (filter === "fix" && Boolean(item.reasons?.includes("fix")));
  return item.reasons.includes(filter as TodoReason);
}

export type TodoGroup = "overdue" | "today" | "upcoming";

export const TODO_GROUPS: ReadonlyArray<{ value: TodoGroup; label: string }> = [
  { value: "overdue", label: "Earlier" },
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Coming up" },
];

/** Which day group an item falls in, in her time zone. */
export function groupOf(item: TodoItem, now = new Date()): TodoGroup {
  const at = new Date(item.at);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (at < startOfToday) return "overdue";
  if (at < startOfTomorrow) return "today";
  return "upcoming";
}

/** A stable key for an item. */
export function todoKey(item: TodoItem): string {
  switch (item.kind) {
    case "session":
      return `s:${item.session.eventId}`;
    case "package":
      return `p:${item.package.id}`;
    case "followUp":
      return `f:${item.followUp.eventId}`;
  }
}

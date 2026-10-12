import type { FollowUp } from "~/features/follow-ups/follow-ups.types";
import type { Session, TodoReason } from "~/features/sessions/sessions.types";

/** One thing on her to-do list; mirrors bizzy-lambda/internal/features/todo. */
export type TodoItem =
  | { kind: "session"; at: string; reasons: Array<TodoReason>; session: Session }
  | { kind: "followUp"; at: string; followUp: FollowUp };

/** The filter chips: a session reason, or follow-ups. */
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
  if (item.kind === "followUp") return filter === "followUp";
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
  return item.kind === "session" ? `s:${item.session.eventId}` : `f:${item.followUp.eventId}`;
}

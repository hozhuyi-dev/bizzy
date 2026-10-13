import type { TodoFilter, TodoGroup } from "./todo.types";

export const TODO_FILTERS: ReadonlyArray<{ value: TodoFilter; label: string }> = [
  { value: "confirm", label: "Confirm" },
  { value: "record", label: "Record" },
  { value: "collect", label: "Collect" },
  { value: "followUp", label: "Follow up" },
  { value: "fix", label: "Fix" },
  { value: "deleted", label: "Deleted" },
];

export const TODO_GROUPS: ReadonlyArray<{ value: TodoGroup; label: string }> = [
  { value: "overdue", label: "Earlier" },
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Coming up" },
];

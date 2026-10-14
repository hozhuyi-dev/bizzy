import type { Conflict } from "~/features/conflicts/conflicts.types";
import type { FollowUp } from "~/features/follow-ups/follow-ups.types";
import type { Package } from "~/features/packages/packages.types";
import type { Session, TodoReason } from "~/features/sessions/sessions.types";

/**
 * One thing on her to-do list; mirrors bizzy-lambda/internal/features/todo.
 * A package is its own item to collect only when bought on its own; one
 * bought in a session is collected on that session. A conflict is an edit
 * she made in the calendar that bizzy didn't apply: each one's buttons are
 * its fixes. An open follow-up is the task itself.
 */
export type TodoItem =
  | { kind: "session"; at: string; reasons: Array<TodoReason>; session: Session }
  | { kind: "package"; at: string; reasons: Array<"collect">; package: Package }
  | { kind: "followUp"; at: string; reasons: Array<"followUp">; followUp: FollowUp }
  | { kind: "conflict"; at: string; reasons: Array<"fix">; conflict: Conflict };

/** The filter chips: a session reason, follow-ups, or what to fix. */
export type TodoFilter = TodoReason | "followUp" | "fix";

export type TodoGroup = "overdue" | "today" | "upcoming";

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

export type TodoGroup = "overdue" | "today" | "upcoming";

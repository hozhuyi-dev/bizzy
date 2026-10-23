import type { ConflictView } from "~/features/conflicts/conflicts.types";
import type { FollowUpView } from "~/features/follow-ups/follow-ups.types";
import type { PackageView } from "~/features/packages/packages.types";
import type { SessionReason, SessionView } from "~/features/sessions/sessions.types";

/**
 * One thing on the to-do list; mirrors bizzy-lambda/internal/features/todo.
 * What is left to do on it is its own `todo`. A package is its own item to
 * collect only when bought on its own; one bought in a session is collected
 * on that session. A conflict is an edit made in the calendar that bizzy
 * refused.
 */
export type TodoView =
  | { kind: "session"; at: string; session: SessionView }
  | { kind: "package"; at: string; package: PackageView }
  | { kind: "followUp"; at: string; followUp: FollowUpView }
  | { kind: "conflict"; at: string; conflict: ConflictView };

/** The filter chips: a session reason, follow-ups, or calendar edits to settle. */
export type TodoFilter = SessionReason | "followUp" | "calendar";

/** Calendar edits first, as they keep the calendar out of step; then the rest by day. */
export type TodoGroup = "calendar" | "overdue" | "today" | "upcoming";

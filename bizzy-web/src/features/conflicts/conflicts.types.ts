import type { Remedy } from "~/core/lambda/lambda.types";

// Mirrors bizzy-lambda/internal/features/conflicts/api.go.

/**
 * An edit the user made in Google Calendar that bizzy refused; mirrors
 * conflicts.View. It waits on the to-do list until the user settles what
 * refused it and applies it (conflicts.apply, or the next sync), or puts
 * bizzy's version back (calendar.revert, always one of its remedies).
 */
export interface ConflictView {
  /** The event edited; conflicts are keyed by it. */
  eventId: string;
  /** What the event shows ("session", "followUp"); unset for a new event. */
  itemKind?: "session" | "followUp";
  itemId?: string;
  /** The user deleted the event. */
  gone?: boolean;
  /** What the event says, which bizzy refused. */
  title: string;
  /** Unset (the zero time) for an all-day event. */
  start: string;
  end: string;
  /** Why it was refused. */
  message: string;
  remedies: Array<Remedy>;
  /** When it was first refused. */
  since: string;
}

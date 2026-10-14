import type { Remedy } from "~/core/lambda/lambda.types";
import type { EventSnapshot } from "~/features/calendar/calendar.types";

// Mirrors bizzy-lambda/internal/features/conflicts/model.go and view.go.

/** What her edit in the calendar did to the event. */
export type ConflictKind = "new" | "changed" | "gone";

/** One guard that refused the edit, and what would let it through; mirrors command.Violation. */
export interface Violation {
  guard: string;
  message: string;
  remedies: Array<Remedy>;
}

/**
 * An edit she made in Google Calendar that bizzy didn't apply: the app is
 * where things are true, and the calendar only asks. It waits here until
 * she undoes it there, settles what refused it and applies it, or (a new
 * event) says it isn't bizzy's. With no violations left it is ready to
 * apply: it waits for her to say so (rule "edit-ready").
 */
export interface Conflict {
  /** "calendar#<eventId>". */
  key: string;
  surface: "calendar";
  externalId: string;
  kind: ConflictKind;
  targetKind?: "session" | "followUp";
  targetId?: string;
  clientId?: string;
  /** The event as last agreed, and as she left it (absent when deleted). */
  seen?: EventSnapshot;
  now?: EventSnapshot;
  /** What the edit asks for, in words. */
  asks: Array<string>;
  violations: Array<Violation>;
  /** When it was first found. */
  at: string;
  version: number;

  // From the API's rules (conflicts/rules.go).
  rules: Array<string>;
  todo: Array<"fix">;
  /** Every action that settles it, its violations' remedies first. */
  fixes: Array<Remedy>;
}

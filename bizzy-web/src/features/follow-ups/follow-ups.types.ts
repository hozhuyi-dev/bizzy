import type { EventLink } from "~/features/calendar/calendar.types";

// Mirrors bizzy-lambda/internal/features/followups/model.go.
export interface FollowUp {
  id: string;
  clientId: string;
  /** The session it was made from. */
  sessionId?: string;
  /** When it is due; for an all-day one, the start of its day. */
  due: string;
  allDay?: boolean;
  /** How long its event blocks in the calendar; 0 when all-day. */
  minutes?: number;
  summary?: string;
  /** Shown as the event's description. */
  notes?: string;
  doneAt?: string;
  event: EventLink;
  createdAt: string;
  version: number;
}

/** A follow-up as she fills it in; mirrors book.FollowUpDraft. */
export interface FollowUpDraft {
  clientId: string;
  sessionId?: string;
  /** YYYY-MM-DD for an all-day reminder, or a start time. */
  date?: string;
  start?: string;
  summary: string;
  notes: string;
}

export type FollowUpView = "upcoming" | "done";

/** What the dialog is for: a new follow-up (maybe for a client, from a session), or one to edit. */
export type FollowUpTarget =
  | { mode: "new"; clientId?: string | undefined; sessionId?: string | undefined }
  | { mode: "edit"; followUp: FollowUp };

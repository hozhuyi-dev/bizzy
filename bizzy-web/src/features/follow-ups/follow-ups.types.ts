// Mirrors bizzy-lambda/internal/features/followups/model.go.
export interface FollowUp {
  eventId: string;
  /** As written in the calendar: `! Name: summary`. */
  title: string;
  /** When it is due; for an all-day one, the start of its day. */
  due: string;
  allDay?: boolean;
  /** The event's description. */
  notes?: string;
  /** The session it was made from. */
  sessionId?: string;

  name?: string;
  summary?: string;
  clientId?: string;
  suggestedClientId?: string;
  /** Why the title can't be read or matched. */
  problem?: string;

  doneAt?: string;
  version: number;
}

/** A follow-up as she fills it in; mirrors googlesync.FollowUpDraft. */
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

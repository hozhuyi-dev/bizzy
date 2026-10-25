import type { ListRequest } from "~/core/list/filter.types";

// Mirrors bizzy-lambda/internal/features/followups/api.go.

/** Why a follow-up is on the to-do list; mirrors followups.Reason. */
export type FollowUpReason = "followUp";

/** A follow-up as the app shows it; mirrors followups.View. */
export interface FollowUpView {
  id: string;
  clientId: string;
  clientName: string;
  /** The session it was made from. */
  sessionId?: string;
  /** When it is due; for an all-day one, the start of its day. */
  due: string;
  allDay: boolean;
  /** How long its event blocks in the calendar; unset when all-day. */
  minutes?: number;
  summary: string;
  /** Shown as the event's description. */
  notes: string;
  doneAt?: string;
  todo: Array<FollowUpReason>;
}

/** When a follow-up is due: a day (all-day), or a time and how long it blocks; mirrors followups.When. */
export type FollowUpWhen = { date: string } | { start: string; minutes?: number };

/**
 * What followUps.create and followUps.update set; mirrors followups.Fields.
 * An update is a patch: what isn't sent stays as it is.
 */
export interface FollowUpFields {
  clientId?: string;
  when?: FollowUpWhen;
  summary?: string;
  notes?: string;
}

/** followUps.create's request: the fields, and the session it is made from. */
export interface CreateFollowUpRequest extends FollowUpFields {
  sessionId?: string;
}

/** How a follow-up stands; mirrors followups.Status. */
export type FollowUpStatus = "open" | "overdue" | "done";

/** Where a follow-up came from; mirrors followups.Origin. */
export type FollowUpOrigin = "session" | "own";

/**
 * followUps.search's request: an empty filter takes every value. Open
 * alone (or with overdue) lists soonest first; anything else latest first.
 */
export interface SearchFollowUpsRequest extends ListRequest {
  statuses: Array<FollowUpStatus>;
  origins: Array<FollowUpOrigin>;
  clientIds: Array<string>;
}

/** The follow-up a page opens: a new one (maybe for a client, from a session), or one to edit. */
export type FollowUpTarget =
  | { mode: "new"; clientId?: string | undefined; sessionId?: string | undefined }
  | { mode: "edit"; followUp: FollowUpView };

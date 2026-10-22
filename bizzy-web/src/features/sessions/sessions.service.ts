import type {
  CoverView,
  PreviewSessionRequest,
  SearchSessionsRequest,
  SessionFields,
  SessionHit,
  SessionPageView,
  SessionView,
} from "./sessions.types";
import type { Page } from "~/core/list/filter.types";
import { invoke } from "~/core/lambda/lambda.client";

export const SessionsService = {
  /** Sessions starting in [from, to), a year at most. */
  list: (from: string, to: string) => invoke<Array<SessionView>>("sessions.list", { from, to }),
  /** A page of the sessions found, latest first. */
  search: (request: SearchSessionsRequest) => invoke<Page<SessionHit>>("sessions.search", request),
  /** A session's page: it, the calendar edits waiting on it, and its follow-ups. */
  page: (id: string) => invoke<SessionPageView>("sessions.page", { id }),
  /** What would pay for a booking with no fee entered, exactly as saving it would choose. */
  preview: (request: PreviewSessionRequest) => invoke<CoverView>("sessions.preview", request),
  // Each is decided by the API's rules, and then written to the calendar.
  create: (fields: SessionFields) => invoke<SessionView>("sessions.create", fields),
  /** A patch: only what is set changes. */
  update: (id: string, fields: SessionFields) => invoke<SessionView>("sessions.update", { id, ...fields }),
  /** Calls it off: it stays, with its record, but holds no time, costs nothing and leaves the calendar. */
  cancel: (id: string, reason: string) => invoke<SessionView>("sessions.cancel", { id, reason }),
  /** Only one booked by mistake. keepPackage keeps the package bought in it as one on its own; it is deleted with it otherwise. */
  delete: (id: string, keepPackage: boolean) => invoke<null>("sessions.delete", { id, keepPackage }),
  /** Leaving out the notes keeps them, for the summary alone. */
  saveRecord: (id: string, summary: string, notes?: string) =>
    invoke<SessionView>("sessions.saveRecord", { id, summary, notes }),
};

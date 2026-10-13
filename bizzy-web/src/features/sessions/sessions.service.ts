import type { Session, SessionDraft, StoredSession } from "./sessions.types";
import type { Page } from "~/core/lambda/lambda.types";
import { invoke } from "~/core/lambda/lambda.client";

export const SessionsService = {
  list: (from: string, to: string) => invoke<Array<Session>>("sessions.list", { from, to }),
  /** A client's sessions, newest first, a page at a time. */
  listByClient: (clientId: string, cursor?: string) =>
    invoke<Page<Session>>("sessions.listByClient", { clientId, cursor }),
  /** Deleted from the calendar, kept for what she recorded. */
  listRemoved: () => invoke<Array<Session>>("sessions.listRemoved"),
  get: (eventId: string) => invoke<StoredSession>("sessions.get", { eventId }),
  // Each writes the calendar first, then updates sessions as a sync would.
  create: (draft: SessionDraft) => invoke<{ eventId: string }>("sessions.create", draft),
  update: (eventId: string, draft: SessionDraft) => invoke<null>("sessions.update", { eventId, ...draft }),
  delete: (eventId: string) => invoke<null>("sessions.delete", { eventId }),
  restore: (eventId: string) => invoke<null>("sessions.restore", { eventId }),
  discard: (eventId: string) => invoke<null>("sessions.discard", { eventId }),
  // Hers, kept only here.
  /** Leaving out the notes keeps them, for the summary alone. */
  saveRecord: (eventId: string, summary: string, notes?: string) =>
    invoke<Session>("sessions.saveRecord", { eventId, summary, notes }),
};

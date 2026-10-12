import type { Session, SessionDraft, StoredSession } from "./sessions.types";
import { invoke } from "~/core/lambda/lambda.client";

export const SessionsService = {
  listOpen: () => invoke<Array<Session>>("sessions.listOpen"),
  list: (from: string, to: string) => invoke<Array<Session>>("sessions.list", { from, to }),
  get: (eventId: string) => invoke<StoredSession>("sessions.get", { eventId }),
  // Each writes the calendar first, then updates sessions as a sync would.
  create: (draft: SessionDraft) => invoke<null>("sessions.create", draft),
  update: (eventId: string, draft: SessionDraft) => invoke<null>("sessions.update", { eventId, ...draft }),
  delete: (eventId: string) => invoke<null>("sessions.delete", { eventId }),
};

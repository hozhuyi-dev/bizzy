import type { Session, SessionDraft, StoredSession } from "./sessions.types";
import type { Page } from "~/core/lambda/lambda.types";
import { invoke } from "~/core/lambda/lambda.client";

export const SessionsService = {
  list: (from: string, to: string) => invoke<Array<Session>>("sessions.list", { from, to }),
  /** A client's sessions, newest first, a page at a time. */
  listByClient: (clientId: string, cursor?: string) =>
    invoke<Page<Session>>("sessions.listByClient", { clientId, cursor }),
  get: (id: string) => invoke<StoredSession>("sessions.get", { id }),
  // Each is decided by the API's guards, and then written to the calendar.
  create: (draft: SessionDraft) => invoke<{ id: string }>("sessions.create", draft),
  /** updatePayment moves what was received to the new amounts, on a receipt not issued yet. */
  update: (id: string, draft: SessionDraft, updatePayment = false) =>
    invoke<Session>("sessions.update", { id, ...draft, updatePayment }),
  /** keepPackage keeps the package bought in it as one of its own; it is deleted with it otherwise. */
  delete: (id: string, keepPackage: boolean) => invoke<null>("sessions.delete", { id, keepPackage }),
  /** Leaving out the notes keeps them, for the summary alone. */
  saveRecord: (id: string, summary: string, notes?: string) =>
    invoke<Session>("sessions.saveRecord", { id, summary, notes }),
};

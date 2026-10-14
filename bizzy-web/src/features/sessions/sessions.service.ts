import type { BookingOptions, PackageChoice, Session, SessionDraft, StoredSession } from "./sessions.types";
import type { Impact } from "~/features/billing/billing.types";
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
  /** What saving a booking (eventId omitted for a new one) would bring on. */
  impact: (eventId: string | undefined, draft: SessionDraft, updatePayment = false) =>
    invoke<Impact>("sessions.impact", { eventId, ...draft, updatePayment }),
  /** What deleting a session would bring on, its package kept or deleted. */
  deleteImpact: (eventId: string, pkg: PackageChoice = "keep") =>
    invoke<Impact>("sessions.deleteImpact", { eventId, package: pkg }),
  // Each writes the calendar first, then updates sessions as a sync would.
  create: (draft: SessionDraft, options: BookingOptions = {}) =>
    invoke<{ eventId: string }>("sessions.create", { ...draft, ...options }),
  update: (eventId: string, draft: SessionDraft, options: BookingOptions = {}) =>
    invoke<null>("sessions.update", { eventId, ...draft, ...options }),
  delete: (eventId: string, pkg: PackageChoice = "keep", confirm = false) =>
    invoke<null>("sessions.delete", { eventId, package: pkg, confirm }),
  restore: (eventId: string) => invoke<null>("sessions.restore", { eventId }),
  discard: (eventId: string) => invoke<null>("sessions.discard", { eventId }),
  // Hers, kept only here.
  /** Leaving out the notes keeps them, for the summary alone. */
  saveRecord: (eventId: string, summary: string, notes?: string) =>
    invoke<Session>("sessions.saveRecord", { eventId, summary, notes }),
};

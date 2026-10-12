import type { FollowUp, FollowUpDraft, FollowUpView } from "./follow-ups.types";
import type { Page } from "~/features/sessions/sessions.types";
import { invoke } from "~/core/lambda/lambda.client";

export const FollowUpsService = {
  list: (view: FollowUpView, cursor?: string) => invoke<Page<FollowUp>>("followUps.list", { view, cursor }),
  listByClient: (clientId: string, cursor?: string) =>
    invoke<Page<FollowUp>>("followUps.listByClient", { clientId, cursor }),
  listBySession: (sessionId: string) => invoke<Array<FollowUp>>("followUps.listBySession", { sessionId }),
  // Each writes the calendar first.
  create: (draft: FollowUpDraft) => invoke<FollowUp>("followUps.create", draft),
  update: (eventId: string, draft: FollowUpDraft) => invoke<FollowUp>("followUps.update", { eventId, ...draft }),
  delete: (eventId: string) => invoke<null>("followUps.delete", { eventId }),
  // Hers, kept only here.
  setDone: (eventId: string, done: boolean) => invoke<FollowUp>("followUps.setDone", { eventId, done }),
};

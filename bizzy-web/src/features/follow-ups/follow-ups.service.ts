import type { FollowUp, FollowUpDraft, FollowUpView } from "./follow-ups.types";
import type { Page } from "~/core/lambda/lambda.types";
import { invoke } from "~/core/lambda/lambda.client";

export const FollowUpsService = {
  list: (view: FollowUpView, cursor?: string) => invoke<Page<FollowUp>>("followUps.list", { view, cursor }),
  listByClient: (clientId: string, cursor?: string) =>
    invoke<Page<FollowUp>>("followUps.listByClient", { clientId, cursor }),
  listBySession: (sessionId: string) => invoke<Array<FollowUp>>("followUps.listBySession", { sessionId }),
  // Each is saved in bizzy, then written to its event.
  create: (draft: FollowUpDraft) => invoke<FollowUp>("followUps.create", draft),
  update: (id: string, draft: FollowUpDraft) => invoke<FollowUp>("followUps.update", { id, ...draft }),
  delete: (id: string) => invoke<null>("followUps.delete", { id }),
  // Hers, kept only here.
  setDone: (id: string, done: boolean) => invoke<FollowUp>("followUps.setDone", { id, done }),
};

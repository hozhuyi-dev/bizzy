import type { CreateFollowUpRequest, FollowUpFields, FollowUpList, FollowUpView } from "./follow-ups.types";
import { invoke } from "~/core/lambda/lambda.client";

export const FollowUpsService = {
  /** Those not done, soonest first, or those done, latest first. */
  list: (view: FollowUpList) => invoke<Array<FollowUpView>>("followUps.list", { view }),
  listByClient: (clientId: string) => invoke<Array<FollowUpView>>("followUps.listByClient", { clientId }),
  listBySession: (sessionId: string) => invoke<Array<FollowUpView>>("followUps.listBySession", { sessionId }),
  // Each is saved in bizzy, then written to its event.
  create: (request: CreateFollowUpRequest) => invoke<FollowUpView>("followUps.create", request),
  /** A patch: only what is set changes. */
  update: (id: string, fields: FollowUpFields) => invoke<FollowUpView>("followUps.update", { id, ...fields }),
  delete: (id: string) => invoke<null>("followUps.delete", { id }),
  /** The app's alone: the calendar doesn't show it. */
  setDone: (id: string, done: boolean) => invoke<FollowUpView>("followUps.setDone", { id, done }),
};

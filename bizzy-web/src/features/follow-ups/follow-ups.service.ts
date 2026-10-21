import type { CreateFollowUpRequest, FollowUpFields, FollowUpView, SearchFollowUpsRequest } from "./follow-ups.types";
import type { Page } from "~/core/list/filter.types";
import { invoke } from "~/core/lambda/lambda.client";

export const FollowUpsService = {
  /** A page of those found: not done, soonest due first, or done, latest due first. */
  search: (request: SearchFollowUpsRequest) => invoke<Page<FollowUpView>>("followUps.search", request),
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

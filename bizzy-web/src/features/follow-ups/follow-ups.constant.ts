import type { Facet } from "~/core/list/filter.types";
import type { FollowUpOrigin, FollowUpStatus } from "./follow-ups.types";

/** What the follow-ups list can be narrowed by, as its URL names them. */
export const FOLLOW_UP_FACETS = ["client", "status", "origin"] as const;

/** How each stands; mirrors followups.Status. Open takes the overdue too. */
export const FOLLOW_UP_STATUSES = {
  open: "Open",
  overdue: "Overdue",
  done: "Done",
} as const satisfies Record<FollowUpStatus, string>;

/** Where each came from; mirrors followups.Origin. */
export const FOLLOW_UP_ORIGINS = {
  session: "From a session",
  own: "On its own",
} as const satisfies Record<FollowUpOrigin, string>;

export const FOLLOW_UP_STATUS_FACET: Facet = {
  key: "status",
  label: "Status",
  options: Object.entries(FOLLOW_UP_STATUSES).map(([value, label]) => ({ value, label })),
};

export const FOLLOW_UP_ORIGIN_FACET: Facet = {
  key: "origin",
  label: "From",
  options: Object.entries(FOLLOW_UP_ORIGINS).map(([value, label]) => ({ value, label })),
  single: true,
};

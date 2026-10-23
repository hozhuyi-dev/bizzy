import type { TimelineKind } from "./timeline.types";

/** The timeline's chip: which kinds of entry to show. */
export const KIND_FACET = "kind";

/** Each kind as its chip names it. */
export const TIMELINE_KINDS: Record<TimelineKind, string> = {
  session: "Sessions",
  followUp: "Follow-ups",
  document: "Documents",
  package: "Packages",
};

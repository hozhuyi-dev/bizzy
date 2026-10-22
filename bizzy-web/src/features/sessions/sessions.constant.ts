import type { SessionLocation } from "./sessions.types";

/** What the sessions list can be narrowed by, as its URL names them. */
export const SESSION_FACETS = ["client", "stage", "place"] as const;

/** The Stage chip's value for cancelled sessions, beside the to-do reasons. */
export const CANCELLED_STAGE = "cancelled";

/** Where a session is, as lists and the Place chip name it. */
export const SESSION_PLACES: Record<SessionLocation, string> = { visit: "Home visit", own: "Your place" };

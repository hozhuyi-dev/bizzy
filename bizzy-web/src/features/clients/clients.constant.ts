/** The lapse windows Reconnect offers, in months; the first is the default. Mirrors activity.LapseMonths. */
export const LAPSE_MONTHS = ["3", "6", "12"] as const;
export type LapseMonths = (typeof LAPSE_MONTHS)[number];

/** Reconnect's chip: lapsed for over that many months. */
export const LAPSE_FACET = "lapse";

/** All clients' chips: where each client stands. Archived ones show only under their chip. */
export const STANDING_FACETS = ["booked", "owes", "credits", "followUp", "archived"] as const;
export type StandingFacet = (typeof STANDING_FACETS)[number];

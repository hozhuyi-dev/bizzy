/** A lapsed client stays off Reconnect this long after she contacts them. */
export const CONTACT_SNOOZE_DAYS = 30;

/** The lapse windows Reconnect offers, in months; the first is the default. */
export const LAPSE_MONTHS = ["3", "6", "12"] as const;
export type LapseMonths = (typeof LAPSE_MONTHS)[number];

/** The chip that makes the list Reconnect: no session in that many months. */
export const LAPSE_FACET = "lapse";

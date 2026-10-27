/** The lapse windows offered, in months. Mirrors activity.LapseMonths. */
export const LAPSE_MONTHS = ["3", "6", "12"] as const;
export type LapseMonths = (typeof LAPSE_MONTHS)[number];

/**
 * What the clients list is narrowed by, as its URL names them: how long
 * since they were seen (Reconnect's chip), where each stands, and what is
 * missing from their details. Archived ones show only under their chip.
 */
export const CLIENT_FACET_KEYS = ["lapse", "booked", "owes", "credits", "followUp", "homeVisits", "missing", "archived"] as const;
export type ClientFacetKey = (typeof CLIENT_FACET_KEYS)[number];

/** A detail a client can be missing, for what is put on receipts and sent by WhatsApp. */
export const MISSING_DETAILS = {
  phone: "Phone",
  idNo: "IC or passport no.",
  contact: "Google contact",
} as const;
export type MissingDetail = keyof typeof MISSING_DETAILS;

/** What "Billed to" decides, said the same on a session, a package and a document. */
export const BILLED_TO_HELP = "Whose invoice it goes on, and who WhatsApp asks to pay.";

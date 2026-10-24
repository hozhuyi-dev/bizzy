/**
 * What the app asks Google for: her contacts and calendar events, and which calendars she has. Outside
 * production also making calendars (and deleting those it made), for `data:copy`.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  ...(import.meta.env.MODE === "production" ? [] : ["https://www.googleapis.com/auth/calendar.app.created"]),
];

export const GOOGLE_CALLBACK_PATH = "/google-callback";

/** The state ties the callback to a consent this tab started. */
export const GOOGLE_STATE_KEY = "bizzy.google-oauth-state";

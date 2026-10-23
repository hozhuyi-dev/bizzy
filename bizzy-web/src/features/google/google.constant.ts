/** What the app asks Google for: her contacts and calendar events, and which calendars she has. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export const GOOGLE_CALLBACK_PATH = "/google-callback";

/** The state ties the callback to a consent this tab started. */
export const GOOGLE_STATE_KEY = "bizzy.google-oauth-state";

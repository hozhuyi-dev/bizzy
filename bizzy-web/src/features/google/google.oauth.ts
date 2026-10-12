/**
 * Connecting Google: the app sends her to Google's consent screen, Google
 * sends her back to /google-callback with a code, and the API trades the
 * code for a refresh token it keeps. The redirect follows the app's origin,
 * so every origin needs `<origin>/google-callback` registered as a redirect
 * URI on the Google OAuth client.
 */

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export const GOOGLE_CALLBACK_PATH = "/google-callback";

// The state ties the callback to a consent this tab started.
const STATE_KEY = "bizzy.google-oauth-state";

export function googleRedirectUri(): string {
  return `${window.location.origin}${GOOGLE_CALLBACK_PATH}`;
}

export function startGoogleConsent(): void {
  const state = crypto.randomUUID();
  try {
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    // Without storage the callback can't verify the state and says so.
  }

  const params = new URLSearchParams({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    // A refresh token, issued again on every consent so reconnecting works.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

/** Reads and forgets the state saved by startGoogleConsent. */
export function takeGoogleState(): string | null {
  try {
    const state = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    return state;
  } catch {
    return null;
  }
}

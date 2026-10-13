import { GOOGLE_CALLBACK_PATH, GOOGLE_SCOPES, GOOGLE_STATE_KEY } from "./google.constant";

/**
 * Connecting Google: the app sends her to Google's consent screen, Google
 * sends her back to /google-callback with a code, and the API trades the
 * code for a refresh token it keeps. The redirect follows the app's origin,
 * so every origin needs `<origin>/google-callback` registered as a redirect
 * URI on the Google OAuth client.
 */
export const GoogleOAuthService = {
  redirectUri(): string {
    return `${window.location.origin}${GOOGLE_CALLBACK_PATH}`;
  },

  startConsent(): void {
    const state = crypto.randomUUID();
    try {
      sessionStorage.setItem(GOOGLE_STATE_KEY, state);
    } catch {
      // Without storage the callback can't verify the state and says so.
    }

    const params = new URLSearchParams({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      redirect_uri: GoogleOAuthService.redirectUri(),
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      // A refresh token, issued again on every consent so reconnecting works.
      access_type: "offline",
      prompt: "consent",
      state,
    });
    window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  },

  /** Reads and forgets the state saved by startConsent. */
  takeState(): string | null {
    try {
      const state = sessionStorage.getItem(GOOGLE_STATE_KEY);
      sessionStorage.removeItem(GOOGLE_STATE_KEY);
      return state;
    } catch {
      return null;
    }
  },
};

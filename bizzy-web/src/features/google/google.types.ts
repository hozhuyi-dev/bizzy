// Mirrors bizzy-lambda/internal/features/googleconnect.
export interface GoogleConnectionView {
  /** The connected account; may differ from the one she signs in with. */
  email: string;
  /** The calendar the sync reads. */
  calendarId: string;
  calendarName: string;
  connectedAt: string;
  /** Set when Google no longer accepts the connection. */
  problem?: string;
}

export interface GoogleCalendar {
  id: string;
  name: string;
  primary?: boolean;
}

/** What Google sends back to /google-callback from the consent screen. */
export interface GoogleCallbackSearch {
  code?: string | undefined;
  state?: string | undefined;
  error?: string | undefined;
}

// Mirrors bizzy-lambda/internal/features/googleconnect.
export interface GoogleConnection {
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

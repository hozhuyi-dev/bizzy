// Mirrors bizzy-lambda/internal/features/calendar/model.go.

/** An event as bizzy reads it; mirrors calendar.Snapshot. */
export interface EventSnapshot {
  title: string;
  /** A timed event's; absent for an all-day one. */
  start?: string;
  end?: string;
  /** An all-day event's day, YYYY-MM-DD. */
  date?: string;
  /** Only on events whose description is bizzy's (a follow-up's notes). */
  description?: string;
}

/** The calendar event showing a session or follow-up; mirrors calendar.Link. */
export interface EventLink {
  /** Unset until the event is written. */
  eventId?: string;
  /** What the event said when bizzy and the calendar last agreed. */
  seen?: EventSnapshot;
  /** The event doesn't show it as it is yet. */
  pending?: boolean;
}

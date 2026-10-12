// Mirrors bizzy-lambda/internal/features/googlesync.
export interface SyncSummary {
  /** Sessions in the range: every timed event bar follow-ups. */
  sessions: number;
  saved: number;
  deleted: number;
  /** Follow-ups added, changed or removed. */
  followUps: number;
  /** Clients whose contact copy changed. */
  contacts: number;
}

export interface SyncRun {
  at: string;
  summary: SyncSummary;
  /** Why the run failed, e.g. Google was disconnected. */
  error?: string;
}

/**
 * The calendar a sync re-reads: dates as YYYY-MM-DD, both included, or the
 * whole calendar. Without one it re-reads the last 60 days. Bookings and
 * contacts are refreshed whatever the range.
 */
export type SyncRange = { from: string; to: string } | { all: true };

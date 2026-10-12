// Mirrors bizzy-lambda/internal/features/googlesync.
export interface SyncSummary {
  /** Timed events in the range; every one is a session. */
  sessions: number;
  saved: number;
  deleted: number;
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

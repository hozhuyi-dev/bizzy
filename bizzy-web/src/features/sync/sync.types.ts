// Mirrors bizzy-lambda/internal/features/calsync.
export interface SyncSummary {
  /** Timed events in the window; every one is a session. */
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

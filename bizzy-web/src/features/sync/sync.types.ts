// Mirrors bizzy-lambda/internal/features/calsync.
export interface SyncSummary {
  sessions: number;
  unmatched: number;
  parseErrors: number;
  skipped: number;
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

// Mirrors bizzy-lambda/internal/features/calsync.
export interface SyncSummary {
  sessions: number;
  unmatched: number;
  parseErrors: number;
  skipped: number;
  saved: number;
  deleted: number;
}

export interface SyncRun {
  at: string;
  summary: SyncSummary;
}

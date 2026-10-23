// Mirrors bizzy-lambda/internal/features/googlesync/api.go.

/** A sync run: how many changed events it read, and how many it refused; mirrors googlesync.View. */
export interface SyncView {
  at: string;
  read: number;
  /** Events refused, waiting on the to-do list as conflicts. */
  refused: number;
  /** Why the run failed, e.g. Google was disconnected. */
  error?: string;
  /** How far back the calendar is read, while older events are still to read (sync.backfill). */
  back?: string;
}

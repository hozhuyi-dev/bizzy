import type { SyncSummary } from "~/features/sync/sync.types";

/** What a reset deleted, and what the full sync after it brought back. */
export interface ResetResult {
  deleted: number;
  synced?: SyncSummary;
  /** Why the sync failed; the data is reset but empty until she syncs. */
  syncError?: string;
}

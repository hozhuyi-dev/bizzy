import type { SyncView } from "~/features/sync/sync.types";

/** What a reset deleted, and what the sync after it read; mirrors reset.View. */
export interface ResetView {
  deleted: number;
  synced?: SyncView;
  /** Why the sync failed; the data is reset but empty until the next sync. */
  syncError?: string;
}

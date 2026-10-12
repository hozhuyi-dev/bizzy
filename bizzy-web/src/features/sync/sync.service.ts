import type { SyncRange, SyncRun, SyncSummary } from "./sync.types";
import { invoke } from "~/core/lambda/lambda.client";

export const SyncService = {
  /** Null before the first sync. */
  status: () => invoke<SyncRun | null>("sync.status"),
  run: (range?: SyncRange) => invoke<SyncSummary>("sync.run", range),
};

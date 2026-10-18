import type { SyncView } from "./sync.types";
import { invoke } from "~/core/lambda/lambda.client";

export const SyncService = {
  /** The last run; null before the first. */
  status: () => invoke<SyncView | null>("sync.status"),
  /** Reads what changed in the calendar since the last run. */
  run: () => invoke<SyncView>("sync.run"),
};

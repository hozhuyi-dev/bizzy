import type { SyncView } from "./sync.types";
import { invoke } from "~/core/lambda/lambda.client";

export const SyncService = {
  /** Reads what changed in the calendar since the last run. */
  run: () => invoke<SyncView>("sync.run"),
  /** Reads the calendar a month or so further back; `back` is unset once it's all read. */
  backfill: () => invoke<SyncView>("sync.backfill"),
};

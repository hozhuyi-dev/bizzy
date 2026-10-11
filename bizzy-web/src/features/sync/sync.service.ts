import type { SyncRun, SyncSummary } from "./sync.types";
import { invoke, invokeCalendarSync } from "~/core/lambda/lambda.client";

export const SyncService = {
  /** Null before the first sync. */
  status: () => invoke<SyncRun | null>("sync.status"),
  run: () => invokeCalendarSync<SyncSummary>(),
};

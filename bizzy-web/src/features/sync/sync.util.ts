import type { SyncRun, SyncSummary } from "./sync.types";
import { formatRelative } from "~/core/utils/date.util";

/** "40 sessions · 3 updated", for the toast after a sync. */
export function describeSync(summary: SyncSummary): string {
  const changes = summary.saved + summary.deleted + summary.followUps + summary.contacts;
  return `${summary.sessions} sessions · ${changes ? `${changes} updated` : "nothing changed"}`;
}

/** What the button says: syncing, never synced, failed or when it last ran. */
export function lastRunText(run: SyncRun | null | undefined, running: boolean): string {
  if (running) return "Syncing…";
  if (run === undefined) return "";
  if (run === null) return "Never synced";
  if (run.error) return `Sync failed ${formatRelative(run.at)}`;
  return `Synced ${formatRelative(run.at)}`;
}

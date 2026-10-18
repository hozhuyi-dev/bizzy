import type { SyncView } from "./sync.types";
import { formatRelative } from "~/core/utils/date.util";

/** "3 changes read · 1 to settle", for the toast after a sync. */
export function describeSync(run: SyncView): string {
  if (run.read === 0) return "Nothing changed";
  const read = `${run.read} ${run.read === 1 ? "change" : "changes"} read`;
  return run.refused > 0 ? `${read} · ${run.refused} to settle on your to-do list` : read;
}

/** What the button says: syncing, never synced, failed or when it last ran. */
export function lastRunText(run: SyncView | null | undefined, running: boolean): string {
  if (running) return "Syncing…";
  if (run === undefined) return "";
  if (run === null) return "Never synced";
  if (run.error) return `Sync failed ${formatRelative(run.at)}`;
  return `Synced ${formatRelative(run.at)}`;
}

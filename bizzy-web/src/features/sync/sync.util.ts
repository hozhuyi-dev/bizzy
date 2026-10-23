import type { SyncView } from "./sync.types";
import { formatDate, formatRelative } from "~/core/utils/date.util";

/** "3 changes read · 1 to settle", for the toast after a sync. */
export function describeSync(run: SyncView): string {
  if (run.read === 0) return "Nothing changed";
  const read = `${run.read} ${run.read === 1 ? "change" : "changes"} read`;
  return run.refused > 0 ? `${read} · ${run.refused} to settle on your to-do list` : read;
}

/** What the button says: syncing, reading older events, never synced, failed or when it last ran. */
export function lastRunText(run: SyncView | null | undefined, running: boolean, backfilling = false): string {
  if (running) return "Syncing…";
  if (backfilling) return "Reading older events…";
  if (run === undefined) return "";
  if (run === null) return "Never synced";
  if (run.error) return `Sync failed ${formatRelative(run.at)}`;
  return `Synced ${formatRelative(run.at)}`;
}

/** The same, short, for a phone's nav bar: "Syncing…", "Failed", "Never synced" or how long ago ("5m ago"). */
export function shortRunText(run: SyncView | null | undefined, running: boolean, backfilling = false, now = new Date()): string {
  if (running || backfilling) return "Syncing…";
  if (run === undefined) return "";
  if (run === null) return "Never synced";
  if (run.error) return "Failed";
  return agoText(run.at, now);
}

/** "just now", "5m ago", "3h ago", "2d ago". */
function agoText(at: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(at).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (60 * 24))}d ago`;
}

/** "Read back to 5 Oct 2025; older events come in next", while the calendar isn't all read. */
export function backText(run: SyncView | null | undefined): string {
  return run?.back ? `Read back to ${formatDate(run.back)}; older events come in next.` : "";
}

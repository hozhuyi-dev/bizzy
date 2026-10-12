import { SyncMutation } from "./sync.query";

/** Syncs the last 60 days once per page load; renders nothing. */
export function SyncOnLoad() {
  SyncMutation.useRunOnLoad();
  return null;
}

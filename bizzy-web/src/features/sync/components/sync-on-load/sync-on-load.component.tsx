import { useSyncOnLoad } from "../../sync.hook";

/** Syncs the last 60 days once per page load; renders nothing. */
export function SyncOnLoad() {
  useSyncOnLoad();
  return null;
}

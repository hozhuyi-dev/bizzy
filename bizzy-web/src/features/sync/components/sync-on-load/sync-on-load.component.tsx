import { useSyncOnLoad } from "../../sync.hook";

/** Syncs once per page load; renders nothing. */
export function SyncOnLoad() {
  useSyncOnLoad();
  return null;
}

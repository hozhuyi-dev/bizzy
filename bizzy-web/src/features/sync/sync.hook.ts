import { useEffect, useRef } from "react";
import { SyncMutation } from "./sync.mutation";

/**
 * Syncs the last 60 days once per page load, so she never has to. A
 * failure shows on the nav bar's Sync button rather than a toast.
 */
export function useSyncOnLoad() {
  const { mutate } = SyncMutation.useRun();
  // StrictMode runs effects twice in development; the ref survives that.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    mutate(undefined);
  }, [mutate]);
}

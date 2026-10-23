import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BACKFILL_PAUSE_MS, SYNC_ON_RETURN_MS } from "./sync.constant";
import { SyncMutation } from "./sync.mutation";
import type { SyncView } from "./sync.types";
import { SyncKeys } from "~/core/constants/query-keys.constant";
import { changes } from "~/core/config/query-client.config";

/**
 * Reads the calendar further back from where a sync got to (its `back`), a
 * month or so a call, so a calendar's whole history comes in without one
 * long wait. It runs on its own, one at a time; one that fails stops, and
 * the next sync goes on from where it got to. What it changed is read
 * again once it stops, so the pages aren't all read again on every call.
 */
export function useBackfill(): (back: string | undefined) => void {
  const queryClient = useQueryClient();
  const { mutateAsync: backfill } = SyncMutation.useBackfill();

  return useCallback(
    (from) => {
      if (!from || queryClient.isMutating({ mutationKey: SyncKeys.backfill() }) > 0) return;
      const release = changes.hold();
      void (async () => {
        let back: string | undefined = from;
        for (let step = 0; back; step++) back = (await backfill(step === 0 ? 0 : BACKFILL_PAUSE_MS)).back;
      })()
        .catch(() => undefined)
        .finally(release);
    },
    [queryClient, backfill],
  );
}

/** Syncs the calendar, then reads older events while there are some (useBackfill); resolves with the sync. */
export function useSyncCalendar(): () => Promise<SyncView> {
  const { mutateAsync: run } = SyncMutation.useRun();
  const backfill = useBackfill();

  return useCallback(async () => {
    const result = await run();
    backfill(result.back);
    return result;
  }, [run, backfill]);
}

/**
 * Syncs once per page load, reading what changed in the calendar since the
 * last sync, so the user never has to; and again on coming back to the app
 * after a while away, when the calendar may have changed. A failure shows
 * on the nav bar's Sync button rather than a toast.
 */
export function useSyncOnLoad() {
  const sync = useSyncCalendar();
  // StrictMode runs effects twice in development; the ref survives that.
  const last = useRef(0);
  useEffect(() => {
    const syncNow = () => {
      last.current = Date.now();
      sync().catch(() => undefined);
    };
    if (last.current === 0) syncNow();
    const onReturn = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= SYNC_ON_RETURN_MS) syncNow();
    };
    document.addEventListener("visibilitychange", onReturn);
    return () => document.removeEventListener("visibilitychange", onReturn);
  }, [sync]);
}

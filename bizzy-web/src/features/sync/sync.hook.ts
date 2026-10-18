import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SyncMutation } from "./sync.mutation";
import type { SyncView } from "./sync.types";
import { SyncKeys } from "~/core/constants/query-keys.constant";

/**
 * Reads the calendar further back from where a sync got to (its `back`), a
 * month or so a call, so a calendar's whole history comes in without one
 * long wait. It runs on its own, one at a time; one that fails stops, and
 * the next sync goes on from where it got to.
 */
export function useBackfill(): (back: string | undefined) => void {
  const queryClient = useQueryClient();
  const { mutateAsync: backfill } = SyncMutation.useBackfill();

  return useCallback(
    (from) => {
      if (!from || queryClient.isMutating({ mutationKey: SyncKeys.backfill() }) > 0) return;
      void (async () => {
        let back: string | undefined = from;
        while (back) back = (await backfill()).back;
      })().catch(() => undefined);
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
 * last sync, so the user never has to. A failure shows on the nav bar's Sync
 * button rather than a toast.
 */
export function useSyncOnLoad() {
  const sync = useSyncCalendar();
  // StrictMode runs effects twice in development; the ref survives that.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    sync().catch(() => undefined);
  }, [sync]);
}

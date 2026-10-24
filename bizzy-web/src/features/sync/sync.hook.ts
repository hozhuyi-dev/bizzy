import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BACKFILL_PAUSE_MS, RETURN_PAUSE_MS, SYNC_ON_RETURN_MS, SYNC_WHILE_OPEN_MS } from "./sync.constant";
import { SyncMutation } from "./sync.mutation";
import type { SyncView } from "./sync.types";
import type { AppStatusView } from "~/features/app/app.types";
import { AppKeys, CLOCK_KEYS, SyncKeys } from "~/core/constants/query-keys.constant";
import { FRESH_MS, changes } from "~/core/config/query-client.config";
import { AppService } from "~/features/app/app.service";

/**
 * Reads the calendar further back from where a sync got to (its `back`), a
 * month or so a call, so a calendar's whole history comes in without one
 * long wait. It runs on its own, one at a time; one that fails stops, and
 * the next sync goes on from where it got to. What it changed is read
 * again once it stops, so the pages aren't all read again on every call;
 * what anything else changes meanwhile is read again at once.
 */
export function useBackfill(): (back: string | undefined) => void {
  const queryClient = useQueryClient();
  const { mutateAsync: backfill } = SyncMutation.useBackfill();

  return useCallback(
    (from) => {
      if (!from || queryClient.isMutating({ mutationKey: SyncKeys.backfill() }) > 0) return;
      const release = changes.hold("sync.backfill");
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
 * Keeps what the app shows true to what changed elsewhere: in the
 * calendar, on another device, or by the clock. It syncs once per page
 * load, so the user never has to. Coming back to the app (its tab, its
 * window, or the connection) syncs again once the last sync is
 * SYNC_ON_RETURN_MS old, and otherwise only asks what changed meanwhile
 * (app.versions, about one read); either reply reads again what others
 * changed (see invoke). While the app stays in view it syncs every
 * SYNC_WHILE_OPEN_MS. Each time, what the clock changes is read again
 * once FRESH_MS old. A failure shows on the nav bar's Sync button rather
 * than a toast.
 */
export function useStayCurrent() {
  const queryClient = useQueryClient();
  const sync = useSyncCalendar();
  // StrictMode runs effects twice in development; the refs survive that.
  const synced = useRef(0);
  const looked = useRef(0);
  const timed = useRef(0);
  useEffect(() => {
    const syncNow = (now: number) => {
      synced.current = now;
      if (queryClient.isMutating({ mutationKey: SyncKeys.run() }) > 0) return;
      sync().catch(() => undefined);
    };
    // The Sync button's, and another device's, count too.
    const lastSync = () => {
      const at = queryClient.getQueryData<AppStatusView>(AppKeys.status())?.sync?.at;
      return Math.max(synced.current, at ? Date.parse(at) : 0);
    };
    const readClock = (now: number) => {
      if (now - timed.current < FRESH_MS) return;
      timed.current = now;
      for (const queryKey of CLOCK_KEYS) void queryClient.invalidateQueries({ queryKey });
    };
    const inView = () => document.visibilityState === "visible";

    const onReturn = () => {
      const now = Date.now();
      if (!inView() || now - looked.current < RETURN_PAUSE_MS) return;
      looked.current = now;
      if (now - lastSync() >= SYNC_ON_RETURN_MS) syncNow(now);
      else AppService.versions().catch(() => undefined);
      readClock(now);
    };
    const whileOpen = () => {
      const now = Date.now();
      if (!inView() || now - lastSync() < SYNC_WHILE_OPEN_MS) return;
      looked.current = now;
      syncNow(now);
      readClock(now);
    };

    if (synced.current === 0) {
      const now = Date.now();
      looked.current = timed.current = now;
      syncNow(now);
    }
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    window.addEventListener("online", onReturn);
    const timer = window.setInterval(whileOpen, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("online", onReturn);
      window.clearInterval(timer);
    };
  }, [queryClient, sync]);
}

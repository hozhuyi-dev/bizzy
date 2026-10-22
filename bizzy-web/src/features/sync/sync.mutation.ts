import { useIsMutating, useMutation } from "@tanstack/react-query";
import { SyncService } from "./sync.service";
import { SyncKeys } from "~/core/constants/query-keys.constant";

/** What a sync changed is read again as any call's is (refreshChanged): nothing, when the calendar didn't change. */
export const SyncMutation = {
  useRun: () =>
    useMutation({
      mutationKey: SyncKeys.run(),
      mutationFn: () => SyncService.run(),
    }),

  /**
   * One step of a backfill, after waiting `pauseMs`. Waiting inside the
   * step keeps it running meanwhile, so the backfill shows as running
   * throughout.
   */
  useBackfill: () =>
    useMutation({
      mutationKey: SyncKeys.backfill(),
      mutationFn: async (pauseMs: number) => {
        if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
        return SyncService.backfill();
      },
    }),

  /** Whether any sync is running, including the one on load. */
  useIsRunning: () => useIsMutating({ mutationKey: SyncKeys.run() }) > 0,

  /** Whether older events are being read. */
  useIsBackfilling: () => useIsMutating({ mutationKey: SyncKeys.backfill() }) > 0,
};

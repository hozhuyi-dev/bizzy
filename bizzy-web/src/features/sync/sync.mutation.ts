import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { SyncService } from "./sync.service";
import { SyncKeys } from "~/core/constants/query-keys.constant";
import { invalidateBilling } from "~/core/utils/query.util";

export const SyncMutation = {
  useRun: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationKey: SyncKeys.run(),
      mutationFn: () => SyncService.run(),
      // A failed run is recorded too, so refresh the status either way.
      onSettled: () => invalidateBilling(queryClient),
    });
  },

  /**
   * One step of a backfill, after waiting `pauseMs`. Waiting inside the
   * step keeps it running meanwhile, so the backfill shows as running
   * throughout. Only the status is refreshed here; useBackfill refreshes the
   * rest once it's done, rather than every page on every step.
   */
  useBackfill: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationKey: SyncKeys.backfill(),
      mutationFn: async (pauseMs: number) => {
        if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
        return SyncService.backfill();
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: SyncKeys.status() }),
    });
  },

  /** Whether any sync is running, including the one on load. */
  useIsRunning: () => useIsMutating({ mutationKey: SyncKeys.run() }) > 0,

  /** Whether older events are being read. */
  useIsBackfilling: () => useIsMutating({ mutationKey: SyncKeys.backfill() }) > 0,
};

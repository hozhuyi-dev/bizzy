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

  useBackfill: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationKey: SyncKeys.backfill(),
      mutationFn: () => SyncService.backfill(),
      onSettled: () => invalidateBilling(queryClient),
    });
  },

  /** Whether any sync is running, including the one on load. */
  useIsRunning: () => useIsMutating({ mutationKey: SyncKeys.run() }) > 0,

  /** Whether older events are being read. */
  useIsBackfilling: () => useIsMutating({ mutationKey: SyncKeys.backfill() }) > 0,
};

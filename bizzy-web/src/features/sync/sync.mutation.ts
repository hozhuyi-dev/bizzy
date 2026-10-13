import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { SyncService } from "./sync.service";
import type { SyncRange } from "./sync.types";
import { SyncKeys } from "~/core/constants/query-keys.constant";
import { invalidateBilling } from "~/core/utils/query.util";

export const SyncMutation = {
  useRun: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationKey: SyncKeys.run(),
      mutationFn: (range?: SyncRange) => SyncService.run(range),
      // A failed run is recorded too, so refresh the status either way.
      onSettled: () => invalidateBilling(queryClient),
    });
  },

  /** Whether any sync is running, including the one on load. */
  useIsRunning: () => useIsMutating({ mutationKey: SyncKeys.run() }) > 0,
};

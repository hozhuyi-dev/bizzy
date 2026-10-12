import { useEffect, useRef } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SyncService } from "./sync.service";
import type { SyncRange } from "./sync.types";
import { SyncKeys } from "~/core/keys.query";
import { invalidateBilling } from "~/core/utils/query.util";

export const SyncQuery = {
  useStatus: () =>
    useQuery({
      queryKey: SyncKeys.status(),
      queryFn: () => SyncService.status(),
    }),
};

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

  /**
   * Syncs the last 60 days once per page load, so she never has to. A
   * failure shows on the nav bar's Sync button rather than a toast.
   */
  useRunOnLoad: () => {
    const { mutate } = SyncMutation.useRun();
    // StrictMode runs effects twice in development; the ref survives that.
    const started = useRef(false);
    useEffect(() => {
      if (started.current) return;
      started.current = true;
      mutate(undefined);
    }, [mutate]);
  },
};

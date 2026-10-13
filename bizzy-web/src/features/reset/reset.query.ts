import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SyncSummary } from "~/features/sync/sync.types";
import { invoke } from "~/core/lambda/lambda.client";
import { AuthKeys } from "~/core/keys.query";

/**
 * Only development and staging builds offer a reset; the production API
 * doesn't serve it either.
 */
export const CAN_RESET = import.meta.env.MODE !== "production";

/** What a reset deleted, and what the full sync after it brought back. */
export interface ResetResult {
  deleted: number;
  synced?: SyncSummary;
  /** Why the sync failed; the data is reset but empty until she syncs. */
  syncError?: string;
}

export const ResetService = {
  reset: () => invoke<ResetResult>("data.reset"),
};

export const ResetMutation = {
  /**
   * Everything the app has cached is gone: reset rather than refetched in
   * place, so no page shows what was deleted while it reloads. Sign-in is
   * kept.
   */
  useReset: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: () => ResetService.reset(),
      onSettled: () => queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== AuthKeys.all[0] }),
    });
  },
};

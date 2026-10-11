import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SyncService } from "./sync.service";
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
      mutationFn: () => SyncService.run(),
      // A failed run is recorded too, so refresh the status either way.
      onSettled: () => invalidateBilling(queryClient),
    });
  },
};

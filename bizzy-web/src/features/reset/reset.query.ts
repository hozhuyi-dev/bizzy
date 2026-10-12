import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "~/core/lambda/lambda.client";

/**
 * Only development and staging builds offer a reset; the production API
 * doesn't serve it either.
 */
export const CAN_RESET = import.meta.env.MODE !== "production";

export const ResetService = {
  reset: () => invoke<{ deleted: number }>("data.reset"),
};

export const ResetMutation = {
  /** Everything the app has cached is gone, so all of it is refetched. */
  useReset: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: () => ResetService.reset(),
      onSettled: () => queryClient.invalidateQueries(),
    });
  },
};

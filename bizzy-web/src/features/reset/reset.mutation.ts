import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ResetService } from "./reset.service";
import { AuthKeys } from "~/core/constants/query-keys.constant";

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

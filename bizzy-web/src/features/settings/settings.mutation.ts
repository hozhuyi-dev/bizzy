import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SettingsService } from "./settings.service";
import type { Settings } from "./settings.types";
import { SettingsKeys } from "~/core/constants/query-keys.constant";
import { invalidateBilling } from "~/core/utils/query.util";

export const SettingsMutation = {
  /** A new session description reaches new invoice lines. */
  useSave: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: Settings) => SettingsService.save(input),
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: SettingsKeys.all });
        await invalidateBilling(queryClient);
      },
    });
  },
};

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SettingsService } from "./settings.service";
import type { SettingsView } from "./settings.types";
import { SettingsKeys } from "~/core/constants/query-keys.constant";
import { keeping } from "~/core/lambda/lambda.client";

export const SettingsMutation = {
  /** Saved as the API returns them, rather than read again; what they show elsewhere is. */
  useSave: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: SettingsView) => keeping(SettingsKeys.all, () => SettingsService.save(input)),
      onSuccess: (saved) => queryClient.setQueryData(SettingsKeys.all, saved),
    });
  },
};

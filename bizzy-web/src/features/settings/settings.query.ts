import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Settings } from "./settings.types";
import { invoke } from "~/core/lambda/lambda.client";
import { SettingsKeys } from "~/core/keys.query";
import { invalidateBilling } from "~/core/utils/query.util";

export const SettingsService = {
  get: () => invoke<Settings>("settings.get"),
  save: (input: Settings) => invoke<Settings>("settings.save", input),
};

export const SettingsQuery = {
  useGet: () =>
    useQuery({
      queryKey: SettingsKeys.all,
      queryFn: () => SettingsService.get(),
    }),
};

export const SettingsMutation = {
  /** A new home-visit colour relocates every session. */
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

import { useQuery } from "@tanstack/react-query";
import { SettingsService } from "./settings.service";
import { SettingsKeys } from "~/core/constants/query-keys.constant";

export const SettingsQuery = {
  useGet: () =>
    useQuery({
      queryKey: SettingsKeys.all,
      queryFn: () => SettingsService.get(),
    }),

  /** What Settings still needs; refreshed with them, as a save invalidates both. */
  useGaps: () =>
    useQuery({
      queryKey: SettingsKeys.gaps(),
      queryFn: () => SettingsService.gaps(),
    }),
};

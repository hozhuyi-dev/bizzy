import { useQuery } from "@tanstack/react-query";
import { SettingsService } from "./settings.service";
import type { AppStatusView } from "~/features/app/app.types";
import { SettingsKeys } from "~/core/constants/query-keys.constant";
import { AppQuery } from "~/features/app/app.query";

const gaps = (status: AppStatusView) => status.gaps;

export const SettingsQuery = {
  useGet: () =>
    useQuery({
      queryKey: SettingsKeys.all,
      queryFn: () => SettingsService.get(),
    }),

  /** What Settings still needs, part of what every page shows around it. */
  useGaps: () => AppQuery.useStatus(gaps),
};

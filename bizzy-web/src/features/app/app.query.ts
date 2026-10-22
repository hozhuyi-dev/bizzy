import { useQuery } from "@tanstack/react-query";
import { AppService } from "./app.service";
import type { AppStatusView } from "./app.types";
import { AppKeys } from "~/core/constants/query-keys.constant";

export const AppQuery = {
  /** One part of what every page shows around it; every part shares the one call. */
  useStatus: <T>(select: (status: AppStatusView) => T) =>
    useQuery({
      queryKey: AppKeys.status(),
      queryFn: () => AppService.status(),
      select,
    }),
};

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActivityService } from "./activity.service";
import type { ActivityView } from "./activity.types";
import { ActivityKeys } from "~/core/constants/query-keys.constant";

export const ActivityQuery = {
  useList: () =>
    useQuery({
      queryKey: ActivityKeys.list(),
      queryFn: () => ActivityService.list(),
    }),

  /** Each client's activity by client id. */
  useByClient: (): ReadonlyMap<string, ActivityView> => {
    const { data } = ActivityQuery.useList();
    return useMemo(() => new Map((data ?? []).map((activity) => [activity.clientId, activity])), [data]);
  },
};

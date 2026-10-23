import { useMemo } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { ActivityService } from "./activity.service";
import type { ActivityView } from "./activity.types";
import { ActivityKeys } from "~/core/constants/query-keys.constant";

const list = () => queryOptions({ queryKey: ActivityKeys.list(), queryFn: () => ActivityService.list() });

export const ActivityQuery = {
  /** For a route's loader (see pageData). */
  list,
  useList: () => useQuery(list()),

  /** Each client's activity by client id. */
  useByClient: (): ReadonlyMap<string, ActivityView> => {
    const { data } = ActivityQuery.useList();
    return useMemo(() => new Map((data ?? []).map((activity) => [activity.clientId, activity])), [data]);
  },
};

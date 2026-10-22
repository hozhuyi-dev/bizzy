import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { InsightsService } from "./insights.service";
import { InsightKeys } from "~/core/constants/query-keys.constant";

export const InsightsQuery = {
  /** A year at a glance, in one call; the year before stays shown while another loads. */
  useYear: (year: number) =>
    useQuery({
      queryKey: InsightKeys.year(year),
      queryFn: () => InsightsService.year(year),
      placeholderData: keepPreviousData,
    }),
};

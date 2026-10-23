import { useQuery } from "@tanstack/react-query";
import { FollowUpsService } from "./follow-ups.service";
import { searchFollowUpsRequest } from "./follow-ups.util";
import type { ListFilter } from "~/core/list/filter.types";
import { FollowUpKeys } from "~/core/constants/query-keys.constant";
import { usePages } from "~/core/list/pages.hook";

export const FollowUpsQuery = {
  /** The follow-ups a filter finds, a page at a time. */
  useSearch: (filter: ListFilter) => {
    const request = searchFollowUpsRequest(filter);
    return usePages(FollowUpKeys.search(request), (after) => FollowUpsService.search({ ...request, after }));
  },
};

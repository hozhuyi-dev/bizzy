import { useQuery } from "@tanstack/react-query";
import { FollowUpsService } from "./follow-ups.service";
import { searchFollowUpsRequest } from "./follow-ups.util";
import type { FollowUpList } from "./follow-ups.types";
import type { ListFilter } from "~/core/list/filter.types";
import { FollowUpKeys } from "~/core/constants/query-keys.constant";
import { usePages } from "~/core/list/filter.hook";

export const FollowUpsQuery = {
  /** The follow-ups a filter finds, a page at a time. */
  useSearch: (view: FollowUpList, filter: ListFilter) => {
    const request = searchFollowUpsRequest(view, filter);
    return usePages(FollowUpKeys.search(request), (after) => FollowUpsService.search({ ...request, after }));
  },

  useBySession: (sessionId: string) =>
    useQuery({
      queryKey: FollowUpKeys.session(sessionId),
      queryFn: () => FollowUpsService.listBySession(sessionId),
    }),
};

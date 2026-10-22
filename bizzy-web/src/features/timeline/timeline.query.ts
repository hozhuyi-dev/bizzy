import { TimelineService } from "./timeline.service";
import { searchTimelineRequest } from "./timeline.util";
import type { ListFilter } from "~/core/list/filter.types";
import { TimelineKeys } from "~/core/constants/query-keys.constant";
import { usePages } from "~/core/list/pages.hook";

export const TimelineQuery = {
  /** A client's story a filter finds, a page at a time. */
  useSearch: (clientId: string, filter: ListFilter) => {
    const request = searchTimelineRequest(clientId, filter);
    return usePages(TimelineKeys.search(request), (after) => TimelineService.search({ ...request, after }));
  },
};

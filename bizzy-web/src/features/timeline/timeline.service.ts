import type { SearchTimelineRequest, TimelinePage } from "./timeline.types";
import { invoke } from "~/core/lambda/lambda.client";

export const TimelineService = {
  /** A page of a client's story, newest first; the first page also has what is coming. */
  search: (request: SearchTimelineRequest) => invoke<TimelinePage>("timeline.search", request),
};

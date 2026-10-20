import type { FollowUpList, FollowUpView, SearchFollowUpsRequest } from "./follow-ups.types";
import type { ListFilter } from "~/core/filter/filter.types";
import { listRequest } from "~/core/filter/filter.util";
import { formatDate, formatSessionTime } from "~/core/utils/date.util";

/** "Tue, 14 Oct · 10:00 am", or the day alone for an all-day one. */
export function formatDue(followUp: FollowUpView): string {
  return followUp.allDay ? formatDate(followUp.due) : formatSessionTime(followUp.due);
}

/** The search the filter asks the API for. */
export function searchFollowUpsRequest(view: FollowUpList, filter: ListFilter): SearchFollowUpsRequest {
  return { ...listRequest(filter), view, clientIds: [...(filter.chips.client ?? [])] };
}

import type { FollowUpList, FollowUpView, SearchFollowUpsRequest } from "./follow-ups.types";
import type { ListFilter } from "~/core/list/filter.types";
import { listRequest } from "~/core/list/filter.util";
import { formatDate, formatSessionTime, startOfDay } from "~/core/utils/date.util";

/** "Tue, 14 Oct · 10:00 am", or the day alone for an all-day one. */
export function formatDue(followUp: FollowUpView): string {
  return followUp.allDay ? formatDate(followUp.due) : formatSessionTime(followUp.due);
}

/** Not done, and due before today. */
export function isOverdue(followUp: FollowUpView, now = new Date()): boolean {
  return !followUp.doneAt && new Date(followUp.due) < startOfDay(now);
}

/** The search the filter asks the API for. */
export function searchFollowUpsRequest(view: FollowUpList, filter: ListFilter): SearchFollowUpsRequest {
  return { ...listRequest(filter), view, clientIds: [...(filter.chips.client ?? [])] };
}

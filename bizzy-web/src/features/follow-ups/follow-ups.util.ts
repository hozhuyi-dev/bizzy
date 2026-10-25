import { FOLLOW_UP_FACETS } from "./follow-ups.constant";
import type { FollowUpOrigin, FollowUpSearch, FollowUpStatus, FollowUpView, SearchFollowUpsRequest } from "./follow-ups.types";
import type { FilterPreset, ListFilter } from "~/core/list/filter.types";
import { filterUrl, listRequest } from "~/core/list/filter.util";
import { oneOf, textParam } from "~/core/utils/url-param.util";
import { formatDate, formatSessionTime, startOfDay } from "~/core/utils/date.util";

/** "Tue, 14 Oct · 10:00 am", or the day alone for an all-day one. */
export function formatDue(followUp: FollowUpView): string {
  return followUp.allDay ? formatDate(followUp.due) : formatSessionTime(followUp.due);
}

/** Not done, and due before today. */
export function isOverdue(followUp: FollowUpView, now = new Date()): boolean {
  return !followUp.doneAt && new Date(followUp.due) < startOfDay(now);
}

/** The follow-ups list's filter in its URL: those still to do, unless it says otherwise. */
export const followUpsUrl = filterUrl(FOLLOW_UP_FACETS, undefined, { status: ["open"] });

/** The search a follow-up's page takes: the list it steps through. */
export function validateFollowUpSearch(search: Record<string, unknown>): FollowUpSearch {
  return {
    ...followUpsUrl.validate(search),
    from: oneOf(search.from, ["home"] as const),
    session: textParam(search.session),
    timeline: textParam(search.timeline),
  };
}

/** The ways the list is usually looked at; Open first, as it opens. */
export const FOLLOW_UP_PRESETS: ReadonlyArray<FilterPreset> = [
  { label: "Open", when: undefined, chips: { status: ["open"] } },
  { label: "Overdue", when: undefined, chips: { status: ["overdue"] } },
  { label: "Done", when: undefined, chips: { status: ["done"] } },
];

/** The search the filter asks the API for. */
export function searchFollowUpsRequest(filter: ListFilter): SearchFollowUpsRequest {
  return {
    ...listRequest(filter),
    statuses: [...(filter.chips.status ?? [])] as Array<FollowUpStatus>,
    origins: [...(filter.chips.origin ?? [])] as Array<FollowUpOrigin>,
    clientIds: [...(filter.chips.client ?? [])],
  };
}

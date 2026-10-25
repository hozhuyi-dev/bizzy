import { useMemo } from "react";
import { FOLLOW_UPS_LIST } from "../../follow-ups.list";
import { followUpsUrl } from "../../follow-ups.util";
import type { FollowUpSearch } from "../../follow-ups.types";
import type { LinkOptions } from "@tanstack/react-router";
import type { ListFilter } from "~/core/list/filter.types";
import type { Parent } from "~/components/shared/layout/page-header/page-header.component";
import { ListPager } from "~/components/shared/list/list-pager/list-pager.component";
import { NO_FILTER } from "~/core/list/filter.util";
import { sessionFollowUpsList } from "~/features/sessions/sessions.list";
import { TODO_FOLLOW_UPS } from "~/features/todo/todo.list";
import { timelineList, timelineParent } from "~/features/timeline/timeline.list";

/** Where a follow-up was opened from, when that isn't the follow-ups list (FollowUpSearch). */
export type FollowUpWithin = Pick<FollowUpSearch, "from" | "session" | "timeline">;

/** What a follow-up's page steps through: where it was opened from, else the follow-ups list's filter. */
export interface FollowUpStepping {
  within: FollowUpWithin;
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/** A follow-up's page, stepping through a list. */
export function followUpLink(id: string, search: FollowUpSearch): LinkOptions {
  return { to: "/follow-ups/$id", params: { id }, search };
}

/**
 * The list a follow-up's page steps through, as its breadcrumb: Home, the
 * session's or client's page it was opened from, else the follow-ups list
 * with its filter.
 */
export function followUpParent(within: FollowUpWithin, filter: ListFilter): Parent {
  if (within.from === "home") return { to: "/", label: "Home" };
  if (within.session) return { to: "/sessions/$id", params: { id: within.session }, label: "Session" };
  if (within.timeline) return timelineParent(within.timeline);
  return { to: "/follow-ups", label: "Follow-ups", search: followUpsUrl.toSearch(filter) };
}

/**
 * Steps through the list the follow-up was opened from: Home's to-do list,
 * a session's follow-ups, a client's timeline's, or the follow-ups list
 * with its filter.
 */
export function FollowUpPager({ id, gone, stepping }: { id: string; gone?: boolean | undefined; stepping: FollowUpStepping }) {
  const { within, filter, onFilterChange } = stepping;
  const { from, session, timeline } = within;
  const ofSession = useMemo(() => session && sessionFollowUpsList(session), [session]);
  const ofTimeline = useMemo(() => timeline && timelineList(timeline, "followUp"), [timeline]);
  const itemLink = (next: string) => followUpLink(next, within);
  if (from === "home") {
    return <ListPager key="home" list={TODO_FOLLOW_UPS} filter={NO_FILTER} current={{ id, gone }} itemLink={itemLink} />;
  }
  if (ofSession) {
    return <ListPager key={session} list={ofSession} filter={NO_FILTER} current={{ id, gone }} itemLink={itemLink} />;
  }
  if (ofTimeline) {
    return <ListPager key={timeline} list={ofTimeline} filter={NO_FILTER} current={{ id, gone }} itemLink={itemLink} />;
  }
  return (
    <ListPager
      key="follow-ups"
      list={FOLLOW_UPS_LIST}
      filter={filter}
      current={{ id, gone }}
      itemLink={(next) => followUpLink(next, followUpsUrl.toSearch(filter))}
      panel={{ onApply: onFilterChange, listLink: (next) => ({ to: "/follow-ups", search: followUpsUrl.toSearch(next) }) }}
    />
  );
}

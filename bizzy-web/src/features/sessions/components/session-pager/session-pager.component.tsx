import { useMemo } from "react";
import { sessionLink } from "../../sessions.columns";
import { SESSIONS_LIST, TODAY_SESSIONS } from "../../sessions.list";
import { sessionPlace, sessionsUrl } from "../../sessions.util";
import type { SessionReturnTo, SessionView } from "../../sessions.types";
import type { ListFilter } from "~/core/list/filter.types";
import { ListPager } from "~/components/shared/list/list-pager/list-pager.component";
import { NO_FILTER } from "~/core/list/filter.util";
import { TODO_SESSIONS } from "~/features/todo/todo.list";
import { timelineList } from "~/features/timeline/timeline.list";

interface SessionPagerProps {
  id: string;
  /** The session, once loaded: where it would sit in a list it isn't in. */
  session?: SessionView | undefined;
  /** It isn't there (deleted): steps go into the list. */
  gone?: boolean | undefined;
  returnTo: SessionReturnTo | undefined;
  /** Opened from a client's timeline: their id. */
  timeline?: string | undefined;
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * Steps through the list the session was opened from: Home's to-do list,
 * to work through it in one go, or today's sessions there; a client's
 * timeline; else the sessions list with its filter.
 */
export function SessionPager({ id, session, gone, returnTo, timeline, filter, onFilterChange }: SessionPagerProps) {
  const ofTimeline = useMemo(() => timeline && timelineList(timeline, "session"), [timeline]);
  if (ofTimeline) {
    return (
      <ListPager
        key={timeline}
        list={ofTimeline}
        filter={NO_FILTER}
        current={{ id, gone }}
        itemLink={(next) => sessionLink(next, { timeline })}
      />
    );
  }
  if (returnTo === "today") {
    return (
      <ListPager
        key="today"
        list={TODAY_SESSIONS}
        filter={NO_FILTER}
        current={{ id, gone }}
        itemLink={(next) => sessionLink(next, { from: "today" })}
      />
    );
  }
  if (returnTo === "home") {
    return (
      <ListPager
        key="home"
        list={TODO_SESSIONS}
        filter={NO_FILTER}
        current={{ id, gone }}
        itemLink={(next) => sessionLink(next, { from: "home" })}
      />
    );
  }
  return (
    <ListPager
      key="sessions"
      list={SESSIONS_LIST}
      filter={filter}
      current={{ id, place: session && sessionPlace(session), gone }}
      itemLink={(next) => sessionLink(next, sessionsUrl.toSearch(filter))}
      panel={{
        onApply: onFilterChange,
        listLink: (next) => ({ to: "/sessions", search: sessionsUrl.toSearch(next) }),
      }}
    />
  );
}

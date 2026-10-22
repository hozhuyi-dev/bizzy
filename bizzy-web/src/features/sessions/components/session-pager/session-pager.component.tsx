import { sessionLink } from "../../sessions.columns";
import { SESSIONS_LIST } from "../../sessions.list";
import { sessionPlace, sessionsUrl } from "../../sessions.util";
import type { SessionReturnTo, SessionView } from "../../sessions.types";
import type { ListFilter } from "~/core/list/filter.types";
import { ListPager } from "~/components/shared/list/list-pager/list-pager.component";
import { NO_FILTER } from "~/core/list/filter.util";
import { TODO_SESSIONS } from "~/features/todo/todo.list";

interface SessionPagerProps {
  id: string;
  /** The session, once loaded: where it would sit in a list it isn't in. */
  session?: SessionView | undefined;
  returnTo: SessionReturnTo | undefined;
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * Steps through the list the session was opened from: Home's to-do list,
 * to work through it in one go, or the sessions list with its filter.
 */
export function SessionPager({ id, session, returnTo, filter, onFilterChange }: SessionPagerProps) {
  if (returnTo === "home") {
    return (
      <ListPager
        key="home"
        list={TODO_SESSIONS}
        filter={NO_FILTER}
        current={{ id }}
        itemLink={(next) => sessionLink(next, { from: "home" })}
      />
    );
  }
  return (
    <ListPager
      key="sessions"
      list={SESSIONS_LIST}
      filter={filter}
      current={{ id, place: session && sessionPlace(session) }}
      itemLink={(next) => sessionLink(next, sessionsUrl.toSearch(filter))}
      panel={{
        onApply: onFilterChange,
        listLink: (next) => ({ to: "/sessions", search: sessionsUrl.toSearch(next) }),
      }}
    />
  );
}

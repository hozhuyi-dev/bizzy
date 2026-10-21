import { useMemo } from "react";
import { SessionsQuery } from "./sessions.query";
import { sessionFacets, sessionPlace } from "./sessions.util";
import type { SessionHit } from "./sessions.types";
import type { FilteredPagerList } from "~/core/list/pager.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { usePagesWindow } from "~/core/list/pager.hook";

/** The sessions list, for a session's page to step through. */
export const SESSIONS_LIST: FilteredPagerList<SessionHit> = {
  noun: "session",
  nouns: "sessions",
  label: "Search sessions",
  dates: true,
  useWindow: (filter) => usePagesWindow(SessionsQuery.useSearch(filter)),
  useFacets: () => {
    const clients = ClientsQuery.useList();
    return useMemo(() => sessionFacets(clients.data ?? []), [clients.data]);
  },
  idOf: (session) => session.id,
  placeOf: sessionPlace,
};

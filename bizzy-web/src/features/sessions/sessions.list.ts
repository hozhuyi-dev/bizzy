import { useMemo } from "react";
import { SessionsQuery } from "./sessions.query";
import { sessionFacets, sessionPlace } from "./sessions.util";
import { allSessionDocuments, boughtIn } from "./session-stage.util";
import type { SessionHit } from "./sessions.types";
import type { FilteredPagerList, PagerList } from "~/core/list/pager.types";
import type { DocumentLink } from "~/features/documents/documents.types";
import type { FollowUpView } from "~/features/follow-ups/follow-ups.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { PackagesQuery } from "~/features/packages/packages.query";
import { useAllWindow, usePagesWindow } from "~/core/list/pager.hook";
import { dayRange } from "~/core/utils/date.util";

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

/** Today's sessions, by id, in order through the day as Home lists them: what one opened there steps through. */
export const TODAY_SESSIONS: PagerList<string> = {
  noun: "session",
  nouns: "sessions",
  useWindow: () => {
    const { from, to } = useMemo(() => dayRange(), []);
    const sessions = SessionsQuery.useRange(from, to);
    const ids = useMemo(
      () => sessions.data && [...sessions.data].sort((a, b) => a.start.localeCompare(b.start)).map((s) => s.id),
      [sessions.data],
    );
    return useAllWindow(ids);
  },
  idOf: (id) => id,
};

/**
 * A session's documents, in the order its page lists them (its invoices,
 * then its receipts, with the package bought in it): what one opened from
 * there steps through.
 */
export function sessionDocumentsList(sessionId: string): PagerList<DocumentLink> {
  return {
    noun: "document",
    nouns: "documents",
    useWindow: () => {
      const session = SessionsQuery.useDetail(sessionId);
      const packages = PackagesQuery.useList(true);
      const docs = useMemo(
        () => session.data && packages.data && allSessionDocuments(session.data, boughtIn(session.data, packages.data)),
        [session.data, packages.data],
      );
      return useAllWindow(docs);
    },
    idOf: (doc) => doc.ref.id,
  };
}

/** A session's follow-ups, in the order its page lists them: what one opened from there steps through. */
export function sessionFollowUpsList(sessionId: string): PagerList<FollowUpView> {
  return {
    noun: "follow-up",
    nouns: "follow-ups",
    useWindow: () => useAllWindow(SessionsQuery.useFollowUps(sessionId).data),
    idOf: (followUp) => followUp.id,
  };
}

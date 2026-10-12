import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { SessionsService } from "./sessions.service";
import { SessionKeys } from "~/core/keys.query";
import { monthRange } from "~/core/utils/date.util";

export const SessionsQuery = {
  /**
   * One session, its draft and notes, read fresh on every visit. Not
   * refetched on focus: a refetch restarts the forms, which would lose what
   * she typed.
   */
  useDetail: (eventId: string) =>
    useQuery({
      queryKey: SessionKeys.detail(eventId),
      queryFn: () => SessionsService.get(eventId),
      gcTime: 0,
      refetchOnWindowFocus: false,
    }),

  /** One local month, "2026-10". */
  useMonth: (month: string) => {
    const { from, to } = monthRange(month);
    return SessionsQuery.useRange(from, to);
  },

  /** Sessions starting in [from, to). */
  useRange: (from: string, to: string) =>
    useQuery({
      queryKey: SessionKeys.range(from, to),
      queryFn: () => SessionsService.list(from, to),
    }),

  /** A client's sessions, newest first; "Load more" reads the next page. */
  useTimeline: (clientId: string) =>
    useInfiniteQuery({
      queryKey: SessionKeys.client(clientId),
      queryFn: ({ pageParam }) => SessionsService.listByClient(clientId, pageParam),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page) => page.next,
    }),

  /** Deleted from the calendar, kept for what she recorded. */
  useRemoved: () =>
    useQuery({
      queryKey: SessionKeys.removed(),
      queryFn: () => SessionsService.listRemoved(),
    }),
};

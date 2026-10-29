import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { SessionsService } from "./sessions.service";
import { searchSessionsRequest } from "./sessions.util";
import type { PreviewSessionRequest } from "./sessions.types";
import type { ListFilter } from "~/core/list/filter.types";
import { SessionKeys } from "~/core/constants/query-keys.constant";
import { usePages } from "~/core/list/pages.hook";

/**
 * A session's page, one call for all its parts, which each select their
 * own. Not read again on focus: a refetch restarts the forms, which would
 * lose what the user typed.
 */
const page = (id: string) =>
  queryOptions({
    queryKey: SessionKeys.detail(id),
    queryFn: () => SessionsService.page(id),
    refetchOnWindowFocus: false,
  });

const range = (from: string, to: string) =>
  queryOptions({ queryKey: SessionKeys.range(from, to), queryFn: () => SessionsService.list(from, to) });

export const SessionsQuery = {
  /** For a route's loader (see pageData). */
  page,
  range,

  /** One session and its notes; read only when `enabled`. */
  useDetail: (id: string, enabled = true) => useQuery({ ...page(id), select: (p) => p.session, enabled }),

  /** The calendar edits waiting on a session's event. */
  useConflicts: (id: string) => useQuery({ ...page(id), select: (p) => p.conflicts }),

  /** The follow-ups made from a session. */
  useFollowUps: (id: string) => useQuery({ ...page(id), select: (p) => p.followUps }),

  /** The sessions a filter finds, latest first, a page at a time. */
  useSearch: (filter: ListFilter) => {
    const request = searchSessionsRequest(filter);
    return usePages(SessionKeys.search(request), (after) => SessionsService.search({ ...request, after }));
  },

  /** Sessions starting in [from, to). */
  useRange: (from: string, to: string) => useQuery(range(from, to)),

  /** The sessions a package could pay for that their fee pays now, latest first; read only when `enabled`. */
  useMovable: (packageId: string, enabled: boolean) =>
    useQuery({ queryKey: SessionKeys.movable(packageId), queryFn: () => SessionsService.movable(packageId), enabled }),

  /** What would pay for a booking; keeps the last answer while the form changes. */
  usePreview: (request: PreviewSessionRequest | undefined) =>
    useQuery({
      queryKey: SessionKeys.preview(request ?? {}),
      queryFn: () => SessionsService.preview(request as PreviewSessionRequest),
      enabled: request !== undefined,
      placeholderData: keepPreviousData,
    }),
};

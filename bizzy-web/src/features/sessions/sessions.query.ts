import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SessionsService } from "./sessions.service";
import { searchSessionsRequest } from "./sessions.util";
import type { PreviewSessionRequest } from "./sessions.types";
import type { ListFilter } from "~/core/list/filter.types";
import { SessionKeys } from "~/core/constants/query-keys.constant";
import { usePages } from "~/core/list/filter.hook";

export const SessionsQuery = {
  /**
   * One session and its notes, read fresh on every visit. Not refetched on
   * focus: a refetch restarts the forms, which would lose what the user
   * typed.
   */
  useDetail: (id: string) =>
    useQuery({
      queryKey: SessionKeys.detail(id),
      queryFn: () => SessionsService.get(id),
      gcTime: 0,
      refetchOnWindowFocus: false,
    }),

  /** The sessions a filter finds, latest first, a page at a time. */
  useSearch: (filter: ListFilter) => {
    const request = searchSessionsRequest(filter);
    return usePages(SessionKeys.search(request), (after) => SessionsService.search({ ...request, after }));
  },

  /** Sessions starting in [from, to). */
  useRange: (from: string, to: string) =>
    useQuery({
      queryKey: SessionKeys.range(from, to),
      queryFn: () => SessionsService.list(from, to),
    }),

  /** A client's sessions, newest first. */
  useByClient: (clientId: string) =>
    useQuery({
      queryKey: SessionKeys.client(clientId),
      queryFn: () => SessionsService.listByClient(clientId),
    }),

  /** What would pay for a booking; keeps the last answer while the form changes. */
  usePreview: (request: PreviewSessionRequest | undefined) =>
    useQuery({
      queryKey: SessionKeys.preview(request ?? {}),
      queryFn: () => SessionsService.preview(request as PreviewSessionRequest),
      enabled: request !== undefined,
      placeholderData: keepPreviousData,
    }),
};

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SessionsService } from "./sessions.service";
import type { PreviewSessionRequest } from "./sessions.types";
import { SessionKeys } from "~/core/constants/query-keys.constant";
import { monthRange } from "~/core/utils/date.util";

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

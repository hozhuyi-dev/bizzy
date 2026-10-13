import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { FollowUpsService } from "./follow-ups.service";
import type { FollowUpView } from "./follow-ups.types";
import { FollowUpKeys } from "~/core/constants/query-keys.constant";

export const FollowUpsQuery = {
  /** A page at a time; "Load more" reads the next. */
  useList: (view: FollowUpView) =>
    useInfiniteQuery({
      queryKey: FollowUpKeys.list(view),
      queryFn: ({ pageParam }) => FollowUpsService.list(view, pageParam),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page) => page.next,
    }),

  useByClient: (clientId: string) =>
    useInfiniteQuery({
      queryKey: FollowUpKeys.client(clientId),
      queryFn: ({ pageParam }) => FollowUpsService.listByClient(clientId, pageParam),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page) => page.next,
    }),

  useBySession: (sessionId: string) =>
    useQuery({
      queryKey: FollowUpKeys.session(sessionId),
      queryFn: () => FollowUpsService.listBySession(sessionId),
    }),
};

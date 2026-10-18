import { useQuery } from "@tanstack/react-query";
import { FollowUpsService } from "./follow-ups.service";
import type { FollowUpList } from "./follow-ups.types";
import { FollowUpKeys } from "~/core/constants/query-keys.constant";

export const FollowUpsQuery = {
  useList: (view: FollowUpList) =>
    useQuery({
      queryKey: FollowUpKeys.list(view),
      queryFn: () => FollowUpsService.list(view),
    }),

  useByClient: (clientId: string) =>
    useQuery({
      queryKey: FollowUpKeys.client(clientId),
      queryFn: () => FollowUpsService.listByClient(clientId),
    }),

  useBySession: (sessionId: string) =>
    useQuery({
      queryKey: FollowUpKeys.session(sessionId),
      queryFn: () => FollowUpsService.listBySession(sessionId),
    }),
};

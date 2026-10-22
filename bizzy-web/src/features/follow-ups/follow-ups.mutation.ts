import { useMutation } from "@tanstack/react-query";
import { FollowUpsService } from "./follow-ups.service";
import type { CreateFollowUpRequest, FollowUpFields } from "./follow-ups.types";

// What each changes is read again as the API says (refreshChanged).
export const FollowUpsMutation = {
  useCreate: () => useMutation({ mutationFn: (request: CreateFollowUpRequest) => FollowUpsService.create(request) }),
  /** A patch: only what is set changes. */
  useUpdate: () =>
    useMutation({
      mutationFn: ({ id, fields }: { id: string; fields: FollowUpFields }) => FollowUpsService.update(id, fields),
    }),
  useDelete: () => useMutation({ mutationFn: (id: string) => FollowUpsService.delete(id) }),
  /** Records getting back to a client today: a follow-up done already. Deleting it undoes it. */
  useReachedOut: () => useMutation({ mutationFn: (clientId: string) => FollowUpsService.reachedOut(clientId) }),
  useSetDone: () =>
    useMutation({ mutationFn: ({ id, done }: { id: string; done: boolean }) => FollowUpsService.setDone(id, done) }),
};
